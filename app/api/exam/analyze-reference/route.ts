import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { EXAM_REFERENCE_MIME_TO_KIND, EXAM_REFERENCES_BUCKET } from "@/lib/exam-reference-storage";
import {
  CHEAP_VISION_MODEL,
  ECONOMY_MODEL,
  EXAM_MODEL,
  FLASHCARD_MODEL,
  HAIKU_MODEL,
  OpenRouterError,
  extractPdfTextViaOcr,
  type ChatMessageInput,
} from "@/lib/ai/openrouter";
import { callOpenRouterResilient } from "@/lib/ai/call-resilient";
import { runThroughLedger } from "@/lib/ai/generation-ledger";
import { EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT, EXAM_STYLE_EXTRACTION_USER_TEXT, buildExamStyleExtractionTextMessage } from "@/lib/ai/exam-prompts";
import { ExamStyleProfileSchema, normalizeExamStyleProfile, type ExamStyleProfile } from "@/lib/ai/exam-schemas";
import { extractPdfTextLayer } from "@/lib/document-extraction";
import { sha256Hex } from "@/lib/hash";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { parseJsonResponse } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits";
import { sealStyleProfile } from "@/lib/exam-style-seal";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Examen Guidé par le Style Prof — step 1 of 2. Extracts the "ADN de style"
 * of a student-uploaded reference exam (old partiel, correction type), so
 * POST /api/exam/generate can later clone its structure onto a brand-new
 * exam covering different courses (see that route's own `styleProfile` body
 * field). The profile is small JSON returned straight to the client, held in
 * React state, and resent verbatim with the generate request.
 *
 * HOW A DOCUMENT IS READ — text first, then independent fallbacks. The first
 * version handed every PDF, as a file, to CHEAP_VISION_MODEL alone. That
 * model has no native file input, so OpenRouter silently ran its OCR plugin
 * on EVERY PDF (typed ones included) and forwarded page images to it; its
 * only provider is Alibaba, and the one retry went back to the same model —
 * a 429 there ("MedArt Neural Engine est très sollicité") ended the analysis.
 * Now:
 *   1. PDF → its own text layer, read locally (free, a second or two). A
 *      typed exam — the usual case — never goes through OCR or vision.
 *   2. Scanned PDF (no real text layer) → mistral-ocr (extractPdfTextViaOcr,
 *      the same OCR as the course-upload fallback) through a signed URL.
 *   3. Exam text → TEXT_ATTEMPTS, text models on separate provider pools.
 *   4. Image, or a PDF steps 1-3 could not handle → models that read the file
 *      itself (a PDF natively — no text layer or OCR involved at all).
 * Every step shares one deadline under maxDuration, and any failure (429,
 * timeout, truncated or unusable answer) moves on to the next model.
 *
 * The validated profile goes through the AI generation ledger, keyed by the
 * file's own sha256: the same exam file (a past paper shared by a whole
 * class) is analyzed once, and a double submit or a retry after a dropped
 * connection reuses that answer. The student's generation unit is still
 * reserved first, whatever the ledger resolves to (billing rule).
 */

// The file itself never comes through this request: Vercel caps a Route
// Handler body at ~4.5 MB, below the app's 10 MB upload cap. The browser
// uploads it straight to Storage first (see ./sign/route.ts) and sends only
// its `path` here; this route downloads it server-side.
const MAX_FILE_BYTES = MAX_UPLOAD_FILE_BYTES;

// One time budget for the whole pipeline, measured from the request's
// arrival and kept under maxDuration, so the stream can always refund and
// write its final result line before the platform kills the function.
const PIPELINE_BUDGET_MS = 270_000;
/** Below this, a new model attempt cannot realistically finish — skip it instead of burning the rest of the budget. */
const MIN_ATTEMPT_MS = 15_000;
const TEXT_LAYER_TIMEOUT_MS = 40_000;
const OCR_TIMEOUT_MS = 90_000;
/** Time always left for the analysis itself when the OCR step runs. */
const ANALYSIS_RESERVE_MS = 90_000;
/** The OCR service fetches the private file through this short-lived signed URL. */
const OCR_SIGNED_URL_TTL_S = 600;

/** A real text layer has at least this many non-blank characters overall... */
const MIN_EXAM_TEXT_CHARS = 200;
/** ...and per page on average: a scanned PDF whose only selectable text is a typed header/footer stays far below it. */
const MIN_TEXT_CHARS_PER_PAGE = 120;
/** ~10k tokens. A professor's style is fully visible in the first pages; the rest would only add cost and latency. */
const MAX_EXAM_TEXT_CHARS = 40_000;

/** Bump when the same file should get a fresh analysis (new pipeline logic). The system prompt is already part of the ledger key. */
const STYLE_PIPELINE_VERSION = 2;
const LEDGER_PEER_WAIT_MS = 45_000;
/** Covers this pipeline's real worst case (PIPELINE_BUDGET_MS). */
const LEDGER_LEASE_MS = 280_000;

type CallOptions = NonNullable<Parameters<typeof callOpenRouterResilient>[1]>;

interface StyleAttempt {
  model: string;
  /** Upper bound for this attempt; lowered to whatever remains of the deadline. */
  timeoutMs: number;
  maxTokens: number;
  reasoning?: CallOptions["reasoning"];
}

// qwen3.8-flash is a HYBRID thinking model: without `enabled: false` its
// hidden reasoning eats the 2,048-token budget and the answer comes back
// truncated. Its only provider is Alibaba, so the models after it run on
// other provider pools (checked live on OpenRouter, 2026-10-21).
const TEXT_ATTEMPTS: StyleAttempt[] = [
  { model: CHEAP_VISION_MODEL, timeoutMs: 60_000, maxTokens: 2048, reasoning: { enabled: false } },
  { model: EXAM_MODEL, timeoutMs: 75_000, maxTokens: 2048 },
  { model: FLASHCARD_MODEL, timeoutMs: 45_000, maxTokens: 2048 },
];

// Models that read the file itself, a PDF natively (no OpenRouter OCR plugin,
// unlike CHEAP_VISION_MODEL, which has no file input). Gemini Flash always
// reasons: `effort: "low"` caps it, and the larger budget leaves room for it
// before the JSON. Haiku does not reason unless asked.
const FILE_READER_ATTEMPTS: StyleAttempt[] = [
  { model: ECONOMY_MODEL, timeoutMs: 90_000, maxTokens: 4096, reasoning: { effort: "low" } },
  { model: HAIKU_MODEL, timeoutMs: 75_000, maxTokens: 2048 },
];

const IMAGE_ATTEMPTS: StyleAttempt[] = [
  { model: CHEAP_VISION_MODEL, timeoutMs: 75_000, maxTokens: 2048, reasoning: { enabled: false } },
  ...FILE_READER_ATTEMPTS,
];

const UNUSABLE_PROFILE_MESSAGE =
  "L'analyse du style n'a pas abouti. Réessaie dans un instant — si le problème persiste, dépose une version plus nette de l'examen (PDF, ou photo bien éclairée).";

/** The document itself has (next to) no readable text — no model will do better with it. */
class ExamUnreadableError extends Error {
  constructor() {
    super("Nous n'avons trouvé presque aucun texte lisible dans ce document. Essaie un PDF plus net, ou une photo bien éclairée (PNG/JPG) de l'examen.");
    this.name = "ExamUnreadableError";
  }
}

/**
 * Vision pattern mirrors app/api/assistant/route.ts: a locally-defined
 * content-part type cast through `as unknown as ChatMessageInput`, since
 * lib/ai/openrouter.ts's own ContentBlock type is text-only. PDFs use
 * OpenRouter's separate `file` block shape
 * (`{type:"file", file:{filename, file_data: "data:application/pdf;base64,..."}}`),
 * distinct from the `image_url` shape used for PNG/JPG.
 */
type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

interface ReferenceExam {
  buffer: Buffer;
  kind: "pdf" | "image";
  mimeType: string;
  fileName: string;
  /** Storage path — the OCR step signs a URL for it. */
  path: string;
}

/** Non-blank characters: page breaks, spaces and newlines carry no exam content. */
function contentChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function isReadableTextLayer(text: string, pages: number | null): boolean {
  const chars = contentChars(text);
  return chars >= MIN_EXAM_TEXT_CHARS && (pages === null || chars / pages >= MIN_TEXT_CHARS_PER_PAGE);
}

function examTextMessages(examText: string): ChatMessageInput[] {
  const compact = examText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const isSample = compact.length > MAX_EXAM_TEXT_CHARS;
  // Cut without leaving half an emoji (a lone surrogate) at the end.
  const text = isSample ? compact.slice(0, MAX_EXAM_TEXT_CHARS).replace(/[\uD800-\uDBFF]$/, "") : compact;
  return [
    { role: "system", content: EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: buildExamStyleExtractionTextMessage(text, isSample) },
  ];
}

function fileMessages(exam: ReferenceExam): ChatMessageInput[] {
  // "image/jpg" is not a registered media type — some providers reject it in a data URL.
  const mediaType = exam.mimeType === "image/jpg" ? "image/jpeg" : exam.mimeType;
  const dataUrl = `data:${mediaType};base64,${exam.buffer.toString("base64")}`;
  const attachment: VisionContentPart =
    exam.kind === "pdf" ? { type: "file", file: { filename: exam.fileName, file_data: dataUrl } } : { type: "image_url", image_url: { url: dataUrl } };
  const parts: VisionContentPart[] = [{ type: "text", text: EXAM_STYLE_EXTRACTION_USER_TEXT }, attachment];
  return [{ role: "system", content: EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT }, { role: "user", content: parts } as unknown as ChatMessageInput];
}

/**
 * Tries each model in turn under the shared deadline. ANY failure — upstream
 * error (429 included), timeout, truncated answer, invalid JSON, unusable
 * profile — moves on to the next one. Throws the last error once every model
 * failed or the time is spent (`previousError` when no attempt could run).
 */
async function runStyleLadder(
  label: string,
  attempts: StyleAttempt[],
  messages: ChatMessageInput[],
  deadline: number,
  previousError?: unknown
): Promise<{ profile: ExamStyleProfile; model: string }> {
  let lastError: unknown = previousError ?? new OpenRouterError("MedArt Neural Engine met trop de temps à répondre. Réessaie dans un instant.", 504);
  for (const [index, attempt] of attempts.entries()) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;
    try {
      const raw = await callOpenRouterResilient(messages, {
        model: attempt.model,
        maxTokens: attempt.maxTokens,
        reasoning: attempt.reasoning,
        timeoutMs: Math.min(attempt.timeoutMs, remaining),
        bypassMock: true,
      });
      return { profile: normalizeExamStyleProfile(parseJsonResponse(raw)), model: attempt.model };
    } catch (error) {
      lastError = error;
      const next = attempts[index + 1];
      console.warn(
        `[exam/analyze-reference] ${label} : échec avec ${attempt.model}${next ? ` — bascule sur ${next.model}` : ""} :`,
        error instanceof Error ? error.message : error
      );
    }
  }
  throw lastError;
}

async function analyzeReferenceExam(exam: ReferenceExam, supabase: ReturnType<typeof getSupabaseAdmin>, deadline: number): Promise<ExamStyleProfile> {
  const startedAt = Date.now();
  const done = (route: string, model: string, profile: ExamStyleProfile) => {
    console.log(`[exam/analyze-reference] Profil extrait (${route}, ${model}) en ${Math.round((Date.now() - startedAt) / 1000)}s.`);
    return profile;
  };

  if (exam.kind === "image") {
    const { profile, model } = await runStyleLadder("image", IMAGE_ATTEMPTS, fileMessages(exam), deadline);
    return done("image", model, profile);
  }

  // 1. The PDF's own text layer.
  let examText: string | null = null;
  let textSource: "texte" | "ocr" = "texte";
  try {
    const layer = await extractPdfTextLayer(exam.buffer, TEXT_LAYER_TIMEOUT_MS);
    if (isReadableTextLayer(layer.text, layer.pages)) {
      examText = layer.text;
    } else {
      console.log(
        `[exam/analyze-reference] Couche texte insuffisante (${contentChars(layer.text)} caractères, ${layer.pages ?? "?"} page(s)) — PDF scanné, passage à l'OCR.`
      );
    }
  } catch (error) {
    console.warn("[exam/analyze-reference] Lecture de la couche texte échouée — passage à l'OCR :", error instanceof Error ? error.message : error);
  }

  // 2. Scanned PDF: OCR, if it still leaves time for the analysis.
  let ocrFoundNoText = false;
  if (!examText) {
    const ocrTimeoutMs = Math.min(OCR_TIMEOUT_MS, deadline - Date.now() - ANALYSIS_RESERVE_MS);
    if (ocrTimeoutMs >= MIN_ATTEMPT_MS) {
      try {
        const { data: signed, error } = await supabase.storage.from(EXAM_REFERENCES_BUCKET).createSignedUrl(exam.path, OCR_SIGNED_URL_TTL_S);
        if (error || !signed?.signedUrl) throw new Error(`URL signée indisponible : ${error?.message ?? "réponse vide"}`);
        const { text } = await extractPdfTextViaOcr(signed.signedUrl, exam.fileName, { timeoutMs: ocrTimeoutMs });
        if (contentChars(text) >= MIN_EXAM_TEXT_CHARS) {
          examText = text;
          textSource = "ocr";
        } else {
          ocrFoundNoText = true;
          console.warn(`[exam/analyze-reference] OCR : seulement ${contentChars(text)} caractères lisibles — lecture directe du PDF.`);
        }
      } catch (error) {
        console.warn("[exam/analyze-reference] OCR échoué — lecture directe du PDF :", error instanceof Error ? error.message : error);
      }
    }
  }

  // 3. Exam text → text models.
  let textFailure: unknown;
  if (examText) {
    try {
      const { profile, model } = await runStyleLadder(`pdf/${textSource}`, TEXT_ATTEMPTS, examTextMessages(examText), deadline);
      return done(`pdf/${textSource}`, model, profile);
    } catch (error) {
      textFailure = error;
      console.warn(`[exam/analyze-reference] Analyse du texte (${textSource}) échouée sur tous les modèles — lecture directe du PDF.`);
    }
  }

  // 4. Last, independent path: models that read the PDF itself.
  try {
    const { profile, model } = await runStyleLadder("pdf/natif", FILE_READER_ATTEMPTS, fileMessages(exam), deadline, textFailure);
    return done("pdf/natif", model, profile);
  } catch (error) {
    // The OCR itself worked and found next to no text: the document is the problem, not the models.
    if (ocrFoundNoText) throw new ExamUnreadableError();
    throw error;
  }
}

/** Student-facing outcome of a failed analysis — provider details stay in the server log. */
function describeFailure(error: unknown): { status: number; message: string } {
  if (error instanceof ExamUnreadableError) return { status: 422, message: error.message };
  // callOpenRouter's own messages are already student-facing and branded (busy, timeout, invalid request) —
  // except a truncated answer, whose advice ("redécoupée") is about another feature.
  if (error instanceof OpenRouterError && !error.truncated && error.status !== 502) return { status: error.status, message: error.message };
  return { status: 502, message: UNUSABLE_PROFILE_MESSAGE };
}

export async function POST(request: NextRequest) {
  const receivedAt = Date.now();
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

  const exam: ReferenceExam = { buffer: Buffer.from(await fileBlob.arrayBuffer()), kind, mimeType, fileName: displayName, path };
  const deadline = receivedAt + PIPELINE_BUDGET_MS;
  const analyze = () =>
    runThroughLedger(
      {
        namespace: "exam-style-profile",
        // Same bytes → same profile, whoever uploads them; a prompt edit or a version bump is a new key.
        key: { fileSha256: sha256Hex(exam.buffer), kind, prompt: EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT, version: STYLE_PIPELINE_VERSION },
        peerWaitMs: LEDGER_PEER_WAIT_MS,
        leaseMs: LEDGER_LEASE_MS,
        isValid: (value) => ExamStyleProfileSchema.safeParse(value).success,
      },
      () => analyzeReferenceExam(exam, supabase, deadline)
    );

  // Heartbeat-streamed answer — same pattern as app/api/studio/podcast and
  // app/api/studio/generate/explication-part: a `{"type":"heartbeat"}\n` line
  // every 15s keeps real bytes flowing while a scanned PDF is read, so no
  // proxy/carrier idle timeout drops the connection. The real outcome is the
  // LAST line (`{"type":"result", ...}`), read client-side by
  // lib/heartbeat-fetch.ts.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Never throws: once the student has left, the stream is cancelled and
      // enqueue would — that must not turn a finished analysis into a refund.
      const send = (line: Record<string, unknown>): boolean => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          return true;
        } catch {
          return false;
        }
      };
      const heartbeatInterval = setInterval(() => {
        if (!send({ type: "heartbeat" })) clearInterval(heartbeatInterval);
      }, 15_000);

      Promise.resolve()
        .then(analyze)
        .then((styleProfile) => {
          // The seal lets this exact profile feed its archetype's shared question bank (lib/exam-style-seal.ts).
          send({ type: "result", success: true, styleProfile, styleProfileSeal: sealStyleProfile(user.id, styleProfile) });
        })
        .catch(async (error) => {
          await refundGeneration(user.id).catch(() => {});
          const { status, message } = describeFailure(error);
          console.error(`[exam/analyze-reference] Analyse échouée (${status}) :`, error instanceof Error ? error.message : error);
          send({ type: "result", success: false, error: message, status });
        })
        .finally(async () => {
          clearInterval(heartbeatInterval);
          await removeUpload();
          try {
            controller.close();
          } catch {
            // Already closed by the client leaving.
          }
        });
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
