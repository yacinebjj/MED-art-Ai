import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { EXAM_REFERENCE_MIME_TO_KIND, EXAM_REFERENCES_BUCKET } from "@/lib/exam-reference-storage";
import { callOpenRouter, OpenRouterError, CHEAP_VISION_MODEL, type ChatMessageInput } from "@/lib/ai/openrouter";
import { EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT, EXAM_STYLE_EXTRACTION_USER_TEXT } from "@/lib/ai/exam-prompts";
import { ExamStyleProfileSchema } from "@/lib/ai/exam-schemas";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";

export const runtime = "nodejs";
export const maxDuration = 300;

// Time budget for the AI work itself, kept under maxDuration so the stream
// can always write its final result line before the platform kills the
// function. The old setup (maxDuration 120 vs. callOpenRouter's 240s default
// timeout, x2 attempts) is what made a heavy PDF end in a platform timeout.
const ANALYSIS_BUDGET_MS = 270_000;
const FIRST_ATTEMPT_TIMEOUT_MS = 180_000;
/** A retry with less time than this would only time out again — fail fast instead. */
const MIN_RETRY_WINDOW_MS = 45_000;

/**
 * Examen Guidé par le Style Prof — step 1 of 2. Extracts the "ADN de style"
 * of a student-uploaded reference exam (old partiel, correction type) via a
 * single vision call, so POST /api/exam/generate can later clone its
 * structure onto a brand-new exam covering different courses (see that
 * route's own `styleProfile` body field). No DB write here: the extracted
 * profile is small, ephemeral JSON returned straight to the client, held in
 * React state, and resent verbatim with the generate request — simpler than
 * a new cache/table for a first version.
 *
 * Vision pattern mirrors app/api/assistant/route.ts exactly: a locally-
 * defined content-part type cast through `as unknown as ChatMessageInput`,
 * since lib/ai/openrouter.ts's own ContentBlock type is text-only and out of
 * scope to widen here. PDFs use OpenRouter's separate `file` block shape
 * (`{type:"file", file:{filename, file_data: "data:application/pdf;base64,..."}}`),
 * distinct from the `image_url` shape used for PNG/JPG.
 */

// The file itself never comes through this request: Vercel caps a Route
// Handler body at ~4.5 MB, below the app's 10 MB upload cap. The browser
// uploads it straight to Storage first (see ./sign/route.ts) and sends only
// its `path` here; this route downloads it server-side.
const MAX_FILE_BYTES = MAX_UPLOAD_FILE_BYTES;

/** See app/api/assistant/route.ts's own VisionContentPart for the identical reasoning behind this cast-only, shared-type-untouched pattern. */
type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

function buildAnalysisMessage(base64: string, mimeType: string, kind: "pdf" | "image", fileName: string): ChatMessageInput {
  const attachment: VisionContentPart =
    kind === "pdf"
      ? { type: "file", file: { filename: fileName, file_data: `data:${mimeType};base64,${base64}` } }
      : { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } };
  const parts: VisionContentPart[] = [{ type: "text", text: EXAM_STYLE_EXTRACTION_USER_TEXT }, attachment];
  return { role: "user", content: parts } as unknown as ChatMessageInput;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`exam-analyze-reference:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  const { path, fileName, mimeType } = (body ?? {}) as { path?: unknown; fileName?: unknown; mimeType?: unknown };
  if (typeof path !== "string" || !path.trim()) {
    return NextResponse.json({ success: false, error: "'path' est requis." }, { status: 400 });
  }
  // Every reference exam is stored under `${userId}/...` (buildExamReferencePath):
  // refuse to read another student's file even if its path leaked.
  if (!path.startsWith(`${user.id}/`) || path.includes("..")) {
    return NextResponse.json({ success: false, error: "Chemin de fichier invalide." }, { status: 403 });
  }
  const kind = typeof mimeType === "string" ? EXAM_REFERENCE_MIME_TO_KIND[mimeType] : undefined;
  if (!kind || typeof mimeType !== "string") {
    return NextResponse.json({ success: false, error: "Format non supporté — dépose un fichier PDF, PNG ou JPG." }, { status: 400 });
  }
  const displayName = typeof fileName === "string" && fileName.trim() ? fileName : "reference-exam";

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }
  const supabase = getSupabaseAdmin();
  // Ephemeral by design: the file is only needed for this one analysis.
  const removeUpload = () =>
    supabase.storage
      .from(EXAM_REFERENCES_BUCKET)
      .remove([path])
      .then(({ error }) => {
        if (error) console.error("[exam/analyze-reference] Suppression du fichier échouée (non bloquant):", error.message);
      })
      .catch(() => {});

  // Downloaded BEFORE streaming starts, so a missing/oversized file still gets
  // a plain, immediate error response.
  const { data: fileBlob, error: downloadError } = await supabase.storage.from(EXAM_REFERENCES_BUCKET).download(path);
  if (downloadError || !fileBlob) {
    console.error("[exam/analyze-reference] Téléchargement depuis le stockage échoué:", downloadError);
    return NextResponse.json({ success: false, error: "Fichier introuvable — renvoie-le puis réessaie." }, { status: 404 });
  }
  // The authoritative size check: the bucket's own limit already enforces it
  // on upload, this guards against a misconfigured bucket.
  if (fileBlob.size > MAX_FILE_BYTES) {
    await removeUpload();
    return NextResponse.json(
      { success: false, error: `Fichier trop volumineux (${(fileBlob.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    await removeUpload();
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  const base64 = Buffer.from(await fileBlob.arrayBuffer()).toString("base64");
  const userMessage = buildAnalysisMessage(base64, mimeType, kind, displayName);
  const startedAt = Date.now();

  async function extractStyleProfile(): Promise<ReturnType<typeof ExamStyleProfileSchema.parse>> {
    let lastError: unknown;
    // One retry on a schema-invalid/failed response — mirrors generateExamBatch's
    // own retry discipline (app/api/exam/generate/route.ts). An unusable
    // extraction fails visibly here (clear error surfaced to the student)
    // rather than silently returning a fabricated generic profile. Each
    // attempt only gets the time still left in ANALYSIS_BUDGET_MS, so the
    // retry can never push the function past maxDuration.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remainingMs = ANALYSIS_BUDGET_MS - (Date.now() - startedAt);
      if (attempt > 1 && remainingMs < MIN_RETRY_WINDOW_MS) break;
      try {
        const raw = await callOpenRouter([{ role: "system", content: EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT }, userMessage], {
          model: CHEAP_VISION_MODEL,
          maxTokens: 2048,
          bypassMock: true,
          timeoutMs: attempt === 1 ? Math.min(FIRST_ATTEMPT_TIMEOUT_MS, remainingMs) : remainingMs,
        });
        const parsed = parseJsonResponse(raw);
        const result = ExamStyleProfileSchema.safeParse(parsed);
        if (!result.success) {
          console.error(`[exam/analyze-reference] Profil invalide (tentative ${attempt}/2):`, result.error.flatten());
          throw new Error("L'IA n'a pas produit un profil de style valide à partir de ce document.");
        }
        return result.data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Échec de l'analyse du style après 2 tentatives.");
  }

  // Heartbeat-streamed answer — same pattern as app/api/studio/podcast and
  // app/api/studio/generate/explication-part: a `{"type":"heartbeat"}\n` line
  // every 15s keeps real bytes flowing while the vision model reads a heavy
  // PDF, so no proxy/carrier idle timeout drops the connection. The real
  // outcome is the LAST line (`{"type":"result", ...}`), read client-side by
  // lib/heartbeat-fetch.ts.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "heartbeat" })}\n`));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15_000);

      extractStyleProfile()
        .then((styleProfile) => {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", success: true, styleProfile })}\n`));
        })
        .catch(async (error) => {
          await refundGeneration(user.id).catch(() => {});
          const status = error instanceof OpenRouterError ? error.status : 502;
          if (!(error instanceof OpenRouterError)) console.error("[exam/analyze-reference] Erreur non gérée:", error);
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", success: false, error: errorMessage(error), status })}\n`));
        })
        .finally(async () => {
          clearInterval(heartbeatInterval);
          await removeUpload();
          controller.close();
        });
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
