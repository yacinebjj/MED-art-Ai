import { NextRequest, NextResponse } from "next/server";
import { OfficeParser } from "officeparser";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres, slugify } from "@/lib/course-generation-shared";

export const runtime = "nodejs"; // officeparser needs the Node runtime, not edge.

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo

/**
 * Lazy-loading architecture: this route ONLY extracts the PDF's text and
 * creates the course row instantly — it never calls the AI. Each Studio tab
 * (explication, mode_visuel, resume, cas_clinique, qcms) is generated on its
 * own, on demand, the first time the student clicks that tab — see the 5
 * routes under app/api/generate/*. A single mega-call generating
 * all 5 sections at once routinely failed on larger PDFs (truncated JSON
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

      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension !== "pdf") {
        console.error(`[generate-course] Extension refusée : "${extension}"`);
        return NextResponse.json({ success: false, error: `Seuls les fichiers PDF sont acceptés (reçu : ".${extension}").` }, { status: 400 });
      }

      if (file.size > MAX_FILE_BYTES) {
        console.error(`[generate-course] Fichier trop volumineux : ${file.size} octets > ${MAX_FILE_BYTES}`);
        return NextResponse.json(
          { success: false, error: `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).` },
          { status: 413 }
        );
      }

      // --- 2. Extraction du texte du PDF -----------------------------------
      console.log("[generate-course] (2/3) Extraction du texte du PDF...");
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const ast = await OfficeParser.parseOffice(buffer, { fileType: "pdf" });
        sourceText = ast.toText().trim();
      } catch (error) {
        console.error("[generate-course] Échec de l'extraction PDF (officeparser):", error);
        return NextResponse.json(
          { success: false, error: `Extraction PDF échouée : ${errorMessage(error)}` },
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

    const slug = `${slugify(title)}-${Date.now()}`;
    console.log(`[generate-course] Slug généré : "${slug}"`);

    // Every content column starts empty (not yet generated) — each Studio
    // tab fills its own column in on first click, via the section route.
    const courseRow: Record<string, unknown> = {
      slug,
      title,
      raw_text: sourceText,
      explication: null,
      mode_visuel: null,
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
      const { error: insertError } = await supabase.from("courses").insert(courseRow);

      if (insertError) {
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
      console.error("[generate-course] Exception non gérée pendant l'insertion Supabase:", error);
      return NextResponse.json(
        { success: false, error: `Exception pendant l'insertion Supabase : ${errorMessage(error)}` },
        { status: 500 }
      );
    }

    console.log(`[generate-course] Terminé avec succès en ${Date.now() - startedAt} ms. slug="${slug}"`);

    return NextResponse.json({ success: true, slug });
  } catch (error) {
    console.error("[generate-course] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
