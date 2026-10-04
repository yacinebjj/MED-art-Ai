import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { callOpenRouter, OpenRouterError, CHEAP_VISION_MODEL, type ChatMessageInput } from "@/lib/ai/openrouter";
import { EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT, EXAM_STYLE_EXTRACTION_USER_TEXT } from "@/lib/ai/exam-prompts";
import { ExamStyleProfileSchema } from "@/lib/ai/exam-schemas";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
export const maxDuration = 120;

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

// Vercel's serverless body ceiling is ~4.5MB for the whole request; a 10MB
// raw file (this route reads it directly from multipart, not JSON) stays
// safely under that after base64-encoding it server-side for the outbound
// OpenRouter call (~1.33x inflation applies only to that outbound payload,
// never to the inbound request body Vercel actually caps).
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ACCEPTED_MIME_TO_KIND: Record<string, "pdf" | "image"> = {
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
};

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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Requête invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "'file' est requis (PDF, PNG ou JPG)." }, { status: 400 });
  }

  const kind = ACCEPTED_MIME_TO_KIND[file.type];
  if (!kind) {
    return NextResponse.json({ success: false, error: "Format non supporté — dépose un fichier PDF, PNG ou JPG." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).` },
      { status: 400 }
    );
  }

  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const userMessage = buildAnalysisMessage(base64, file.type, kind, file.name || "reference-exam");

    let styleProfile: ReturnType<typeof ExamStyleProfileSchema.parse> | null = null;
    let lastError: unknown;
    // One retry on a schema-invalid response — mirrors generateExamBatch's
    // own retry discipline (app/api/exam/generate/route.ts). An unusable
    // extraction fails visibly here (clear error surfaced to the student)
    // rather than silently returning a fabricated generic profile.
    for (let attempt = 1; attempt <= 2 && !styleProfile; attempt++) {
      try {
        const raw = await callOpenRouter([{ role: "system", content: EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT }, userMessage], {
          model: CHEAP_VISION_MODEL,
          maxTokens: 2048,
          bypassMock: true,
        });
        const parsed = parseJsonResponse(raw);
        const result = ExamStyleProfileSchema.safeParse(parsed);
        if (!result.success) {
          console.error(`[exam/analyze-reference] Profil invalide (tentative ${attempt}/2):`, result.error.flatten());
          throw new Error("L'IA n'a pas produit un profil de style valide à partir de ce document.");
        }
        styleProfile = result.data;
      } catch (error) {
        lastError = error;
      }
    }

    if (!styleProfile) {
      throw lastError instanceof Error ? lastError : new Error("Échec de l'analyse du style après 2 tentatives.");
    }

    return NextResponse.json({ success: true, styleProfile });
  } catch (error) {
    await refundGeneration(user.id);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[exam/analyze-reference] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
