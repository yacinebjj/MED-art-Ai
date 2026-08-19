import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { errorMessage, sanitizeForPostgres, slugify } from "@/lib/course-generation-shared";
import { ACCEPTED_DOCUMENT_EXTENSIONS, extractDocumentText } from "@/lib/document-extraction";
import { getEmbedding } from "@/lib/ai/embeddings";
import { buildSourceChunks } from "@/lib/search/source-chunking";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs"; // officeparser needs the Node runtime, not edge.

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo

/**
 * Lazy-loading architecture: this route ONLY extracts the PDF's text and
 * creates the course row instantly — it never calls the AI. Each Studio tab
 * (explication, resume, cas_clinique, qcms) is generated on its
 * own, on demand, the first time the student clicks that tab — see the
 * routes under app/api/generate/*. A single mega-call generating
 * all sections at once routinely failed on larger PDFs (truncated JSON
 * from hitting the model's output ceiling); splitting per-section removes
 * that failure mode entirely and makes the upload itself near-instant.
 *
 * Requires a `raw_text` column on the `courses` table (text, nullable) —
 * add it once via the Supabase SQL editor if it isn't there yet:
 *   alter table courses add column if not exists raw_text text;
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    // Auth required — this creates a public showcase course (real embedding
    // call + Supabase write) and must never be reachable anonymously.
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
    }

    const rl = rateLimit(`generate-course:${user.id}`, RATE_LIMITS.ai);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
      );
    }

    // --- 1. Réception & validation de l'entrée (fichier PDF OU texte collé) ---
    console.log("[generate-course] (1/3) Réception de la requête...");

    const formData = await request.formData();
    const candidate = formData.get("file");
    const pastedText = formData.get("text");

    let sourceText: string;
    let title: string;

    if (candidate instanceof File) {
      const file = candidate;
      console.log(`[generate-course] Fichier reçu : "${file.name}" (${file.size} octets, type "${file.type}")`);

      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)) {
        console.error(`[generate-course] Extension refusée : "${extension}"`);
        return NextResponse.json(
          { success: false, error: `Format non supporté (reçu : ".${extension}"). Formats acceptés : PDF, DOCX, PPTX, TXT.` },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_BYTES) {
        console.error(`[generate-course] Fichier trop volumineux : ${file.size} octets > ${MAX_FILE_BYTES}`);
        return NextResponse.json(
          { success: false, error: `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).` },
          { status: 413 }
        );
      }

      // --- 2. Extraction du texte du document --------------------------------
      console.log(`[generate-course] (2/3) Extraction du texte (${extension})...`);
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        sourceText = await extractDocumentText(buffer, extension);
      } catch (error) {
        console.error(`[generate-course] Échec de l'extraction ${extension}:`, error);
        return NextResponse.json(
          { success: false, error: `Extraction échouée : ${errorMessage(error)}` },
          { status: 422 }
        );
      }

      title = sanitizeForPostgres(file.name.replace(/\.[^/.]+$/, ""));
    } else if (typeof pastedText === "string") {
      console.log(`[generate-course] Texte collé reçu (${pastedText.length} caractères).`);
      sourceText = pastedText.trim();

      const pastedTitle = formData.get("title");
      title = sanitizeForPostgres(
        typeof pastedTitle === "string" && pastedTitle.trim() ? pastedTitle.trim() : sourceText.slice(0, 60).trim()
      );
    } else {
      console.error("[generate-course] Ni fichier ni texte dans le FormData. Clés reçues:", [...formData.keys()]);
      return NextResponse.json({ success: false, error: "Aucun contenu reçu (ni fichier, ni texte)." }, { status: 400 });
    }

    sourceText = sanitizeForPostgres(sourceText);
    console.log(`[generate-course] Texte source : ${sourceText.length} caractères.`);

    if (sourceText.length < 50) {
      console.error("[generate-course] Texte source trop court:", JSON.stringify(sourceText.slice(0, 200)));
      return NextResponse.json(
        { success: false, error: "Le contenu est trop court ou illisible (pas assez de texte exploitable)." },
        { status: 422 }
      );
    }

    // --- 3. Création instantanée de la ligne dans Supabase ---------------------
    console.log("[generate-course] (3/3) Création de l'espace de cours dans Supabase...");

    if (!isSupabaseConfigured()) {
      console.error("[generate-course] Supabase non configuré (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants).");
      return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants)." }, { status: 500 });
    }

    // Plan quota RESERVATION — moved here (was previously checked before
    // even file validation) so a rejected upload (bad extension, too large,
    // too short) never burns a reservation for work that was never going to
    // happen. Placed before the embedding call below (a real, if small, API
    // cost) rather than after, atomically reserving in one step (see
    // reserveGeneration's own comment — closes a TOCTOU race the old
    // check-then-record split had). If the Supabase insert below then fails,
    // refundGeneration() undoes it — this route's original intent (see the
    // comment above the old recordGeneration call) was that quota tracks
    // "did a course row actually get created", not "did we spend anything".
    const gate = await reserveGeneration(user);
    if (!gate.allowed) {
      return NextResponse.json({ success: false, error: gate.reason }, { status: 403 });
    }

    const slug = `${slugify(title)}-${Date.now()}`;
    console.log(`[generate-course] Slug généré : "${slug}"`);

    // Fingerprint the course content for "Silent Semantic Deduplication"
    // (see lib/course-generation-shared.ts generateCourseSection()) — computed
    // ONCE here so every later section-generation click can reuse it for a
    // free similarity search instead of re-embedding the text each time.
    // Fail-open: the upload must stay instant and must never fail because of
    // this — if the embedding call errors, content_embedding just stays null,
    // and this course silently falls back to normal generation for every
    // section (exactly like before this feature existed), no student-facing
    // impact either way.
    let contentEmbedding: number[] | null = null;
    try {
      contentEmbedding = await getEmbedding(sourceText);
    } catch (error) {
      console.error("[generate-course] Échec calcul de l'embedding de contenu (non bloquant, upload continue):", errorMessage(error));
    }

    // Every content column starts empty (not yet generated) — each Studio
    // tab fills its own column in on first click, via the section route.
    const courseRow: Record<string, unknown> = {
      slug,
      title,
      raw_text: sourceText,
      content_embedding: contentEmbedding,
      explication: null,
      "resumé": null,
      cas_clinique: null,
      qcms: null,
      // Unassigned by default — the student sorts it into a module later
      // from the dashboard's "Mes cours" section (kebab menu > "Ajouter à un module").
      module_id: null,
    };

    console.log("[generate-course] Colonnes envoyées à Supabase :", Object.keys(courseRow).join(", "));

    try {
      const supabase = getSupabaseAdmin();
      let { error: insertError } = await supabase.from("courses").insert(courseRow);

      // Missing-column errors happen if the `content_embedding` migration
      // (supabase/schema.sql) hasn't been run yet — PostgREST rejects the
      // payload itself with "PGRST204" (schema cache has no such column)
      // before the query ever reaches Postgres, so the raw Postgres code
      // "42703" never actually surfaces here; checked for anyway in case a
      // future Supabase version routes this differently. Retry once without
      // the column rather than failing the whole upload: course creation
      // must never depend on a migration timing detail. The course still
      // gets created normally; it just won't participate in Smart Clone
      // deduplication until the column exists.
      if ((insertError?.code === "PGRST204" || insertError?.code === "42703") && "content_embedding" in courseRow) {
        console.warn(
          "[generate-course] Colonne 'content_embedding' absente (migration non exécutée) — nouvel essai sans elle."
        );
        const { content_embedding: _omittedEmbedding, ...courseRowWithoutEmbedding } = courseRow;
        ({ error: insertError } = await supabase.from("courses").insert(courseRowWithoutEmbedding));
      }

      if (insertError) {
        await refundGeneration(user.id);
        console.error("[generate-course] Échec insertion Supabase — détail complet:", {
          code: insertError.code,
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
        });
        return NextResponse.json(
          {
            success: false,
            error: `Insertion Supabase échouée [${insertError.code ?? "??"}] : ${insertError.message}`,
            supabase: {
              code: insertError.code,
              message: insertError.message,
              details: insertError.details,
              hint: insertError.hint,
            },
          },
          { status: 500 }
        );
      }
    } catch (error) {
      await refundGeneration(user.id);
      console.error("[generate-course] Exception non gérée pendant l'insertion Supabase:", error);
      return NextResponse.json(
        { success: false, error: `Exception pendant l'insertion Supabase : ${errorMessage(error)}` },
        { status: 500 }
      );
    }

    // No separate "record usage" call needed here anymore — reserveGeneration
    // above already incremented atomically, before the embedding call even
    // ran. The course row now exists, so the reservation correctly stands.

    // Chunk-based Smart Clone indexing — fail-open exactly like
    // content_embedding above, and deliberately AFTER the course row already
    // exists (course_source_chunks.course_slug references courses.slug).
    // Chunks the raw text (available now, before any section is generated)
    // so lib/course-generation-shared.ts can compare this course against
    // others at the paragraph level, not just as one whole-document vector —
    // see supabase/schema.sql's course_source_chunks for why this exists
    // alongside content_embedding rather than instead of it.
    try {
      const chunks = buildSourceChunks(sourceText);
      if (chunks.length > 0) {
        const chunkEmbeddings = await Promise.all(chunks.map((chunk) => getEmbedding(chunk)));
        const chunkRows = chunks.map((content, i) => ({
          course_slug: slug,
          chunk_index: i,
          content,
          embedding: chunkEmbeddings[i],
        }));
        const supabase = getSupabaseAdmin();
        const { error: chunkError } = await supabase.from("course_source_chunks").insert(chunkRows);
        if (chunkError) {
          console.error("[generate-course] Échec indexation des chunks source (non bloquant):", chunkError.message);
        } else {
          console.log(`[generate-course] ${chunks.length} chunk(s) source indexé(s) pour slug="${slug}".`);
        }
      }
    } catch (error) {
      console.error("[generate-course] Échec calcul des chunks source (non bloquant, upload continue):", errorMessage(error));
    }

    console.log(`[generate-course] Terminé avec succès en ${Date.now() - startedAt} ms. slug="${slug}"`);

    return NextResponse.json({ success: true, slug });
  } catch (error) {
    console.error("[generate-course] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
