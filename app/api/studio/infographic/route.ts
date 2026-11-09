import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { buildFicheSynthesePrompt, extractFicheOutline, ficheContentHash, generateFicheImage } from "@/lib/ai/infographic-sheet";
import { FICHE_STORAGE_FOLDER, FICHE_SYNTHESE_VERSION, ficheSourceText, isFicheSyntheseUrl } from "@/lib/infographic-fiche-key";
import {
  lookupStudioInfographicCache,
  recordStudioInfographicCacheHit,
  storeStudioInfographicCache,
} from "@/lib/studio-infographic-cache";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { LedgerBusyError, runThroughLedger } from "@/lib/ai/generation-ledger";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Every model call of this route ends before this point (ms after the request starts), inside maxDuration. */
const ROUTE_BUDGET_MS = 280_000;

const INFOGRAPHIC_BUCKET = "studio-infographics";

interface CourseRow {
  id: number;
  title: string;
  explication: string | null;
  raw_text: string | null;
}

/** Mirrors app/api/upload/route.ts's ensureSourceFilesBucket exactly — a concurrent request can win the race to create the bucket between the listBuckets check and this call, which is not a real failure. */
async function ensureInfographicBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === INFOGRAPHIC_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(INFOGRAPHIC_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

/**
 * Persists the sheet's URL onto the student's OWN studio_courses row, so it
 * reloads deterministically (the course loader reads infographic_url first).
 * Best-effort: a write failure is logged, never thrown, so it can never fail
 * an otherwise-successful generation.
 */
async function persistInfographicUrl(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  courseId: number,
  userId: string,
  imageUrl: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("studio_courses")
      .update({ infographic_url: imageUrl })
      .eq("id", courseId)
      .eq("user_id", userId);
    if (error) console.error("[studio/infographic] Persistance infographic_url échouée (non bloquant):", error.message);
  } catch (error) {
    console.error("[studio/infographic] Persistance infographic_url échouée (non bloquant):", error instanceof Error ? error.message : error);
  }
}

/** `data:image/png;base64,AAAA...` -> { buffer, contentType }. Throws if the shape doesn't match — a malformed data URL here means the model response parsing (lib/ai/openrouter.ts) already found something wrong. */
function decodeImageDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Format d'image inattendu renvoyé par le modèle.");
  }
  return { buffer: Buffer.from(match[2], "base64"), contentType: match[1] };
}

function imageExtension(contentType: string): string {
  const subtype = contentType.split("/")[1]?.toLowerCase() ?? "png";
  if (subtype === "jpeg") return "jpg";
  return /^[a-z0-9]+$/.test(subtype) ? subtype : "png";
}

/**
 * STEP 2 of the Studio "Infographie / Fiche de Synthèse" (product order
 * 2026-11-09, lib/ai/infographic-sheet.ts): the illustrated sheet itself.
 *  1. The student's unit is reserved first (billing rule below).
 *  2. The shared cross-student cache, keyed by the sheet version + course
 *     text: a hit is served at once.
 *  3. Otherwise the plan — step 1's (app/api/studio/infographic/prompt), from
 *     the generation ledger for 0 tokens; extracted here if step 1 never ran —
 *     is poured into the strict prompt, which goes to the image model. The
 *     image is uploaded to Supabase Storage (fiche-synthese/…), cached for
 *     every student with the same course, and saved on the student's course.
 * The prompt is always built here, from the student's own course — never
 * taken from the request.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-infographic:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  // Only the course: the sheet is French-only with fixed models (an older
  // client's `language` / `model` fields are ignored).
  const { courseId } = (body ?? {}) as { courseId?: unknown };
  if (typeof courseId !== "number" || !Number.isFinite(courseId)) {
    return NextResponse.json({ success: false, error: "'courseId' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: course, error: courseError } = await supabase
    .from("studio_courses")
    .select("id, title, explication, raw_text")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<CourseRow>();

  if (courseError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
  }
  if (!course) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const sourceText = ficheSourceText(course);
  if (!sourceText) {
    return NextResponse.json({ success: false, error: "Ce cours n'a pas assez de contenu source pour générer une fiche de synthèse." }, { status: 400 });
  }

  const contentHash = ficheContentHash(sourceText);

  // BILLING RULE: the student's standard unit is consumed on every request,
  // including one served from the shared cache below — caches only cut OUR
  // model bill. Refunded only when no sheet is delivered.
  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  try {
    const cachedUrl = await lookupStudioInfographicCache(contentHash);
    if (cachedUrl && isFicheSyntheseUrl(cachedUrl)) {
      await recordStudioInfographicCacheHit(contentHash);
      // Persisted even on a cache hit — this student's row may not point at it yet.
      await persistInfographicUrl(supabase, courseId, user.id, cachedUrl);
      return NextResponse.json({ success: true, imageUrl: cachedUrl, cached: true });
    }

    const { outline, source } = await extractFicheOutline({ courseTitle: course.title, sourceText, contentHash });
    const prompt = buildFicheSynthesePrompt(outline);
    // A plan built from the course's headings (every text model failed) stays
    // this student's: its sheet is neither the course's shared file nor cached
    // for other students, who get a model-written plan later.
    const shared = source !== "course-headings";

    // Single-flight per prompt (generation ledger, our bill only — the
    // student's unit was reserved above): an identical request arriving while
    // the image is still being drawn waits for it instead of paying for a
    // second one; if it isn't ready in time, a retryable "already in
    // progress" answer (onPeerTimeout: "fail"), never a duplicate bill.
    const imageUrl = await runThroughLedger(
      {
        namespace: "infographic-fiche-image",
        key: { version: FICHE_SYNTHESE_VERSION, contentHash, prompt },
        peerWaitMs: Math.max(0, Math.min(150_000, ROUTE_BUDGET_MS - (Date.now() - startedAt) - 20_000)),
        leaseMs: 260_000,
        onPeerTimeout: "fail",
        isValid: (value) => isFicheSyntheseUrl(typeof value === "string" ? value : null),
      },
      async () => {
        const { imageDataUrl, model } = await generateFicheImage(prompt, startedAt + ROUTE_BUDGET_MS);
        const { buffer, contentType } = decodeImageDataUrl(imageDataUrl);

        await ensureInfographicBucket(supabase);
        const path = `${FICHE_STORAGE_FOLDER}/${contentHash}${shared ? "" : `-${user.id}`}.${imageExtension(contentType)}`;
        const { error: uploadError } = await supabase.storage.from(INFOGRAPHIC_BUCKET).upload(path, buffer, { contentType, upsert: true });
        if (uploadError) throw uploadError;

        const generatedUrl = supabase.storage.from(INFOGRAPHIC_BUCKET).getPublicUrl(path).data.publicUrl;
        console.log(`[studio/infographic] Fiche de synthèse générée (${model}, plan : ${source}) → ${path}`);

        // Stored BEFORE returning — the next student with this course gets it
        // at once. Fail-open: storeStudioInfographicCache logs its own errors
        // and never throws.
        if (shared) await storeStudioInfographicCache(contentHash, generatedUrl);
        return generatedUrl;
      }
    );

    await persistInfographicUrl(supabase, courseId, user.id, imageUrl);
    return NextResponse.json({ success: true, imageUrl, cached: false });
  } catch (error) {
    await refundGeneration(user.id);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    if (error instanceof LedgerBusyError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    console.error("[studio/infographic] Échec génération/upload:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
