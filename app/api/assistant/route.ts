import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { HAIKU_MODEL, FREE_MODEL_CHAIN, OpenRouterError, streamOpenRouter, type ChatMessageInput } from "@/lib/ai/openrouter";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { reserveFreeTierCapacity } from "@/lib/platform-spend-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // streamed chat reply — no explicit cap before, so it silently rode Vercel's platform default.

/**
 * MedArt Assistant — free-flowing companion chat, distinct from
 * app/api/courses/chat/route.ts (which is scoped to one course's raw_text).
 * No course context here, so no source-text cache breakpoint like that
 * route has — but the SYSTEM PROMPT itself is byte-identical across every
 * student, every conversation, forever, which is exactly what Anthropic
 * prompt caching wants: marked cache_control below so only the very first
 * call platform-wide (or the first one past the TTL) pays full price for it.
 *
 * Stateless server-side: history lives in the client's React state only
 * (per spec — "maintains conversation history in the state"), nothing is
 * persisted to Supabase here. A refresh loses the conversation. If that
 * needs to survive a refresh later, that's a real, separate feature
 * (a table + GET/POST pair, same shape as course_chat_history).
 *
 * Also not wired into the plan-quota system (courses/highlight_messages) —
 * this is a third kind of AI usage the 6 plans don't currently meter at
 * all. Flagged, not hidden: decide deliberately whether it needs its own
 * quota before this ships to real students, don't assume it's covered.
 */

const MAX_HISTORY_MESSAGES = 20; // more headroom than course-chat's 10 — no source-text context competing for the same token budget here
const MAX_MESSAGE_CHARS = 4000;

// Inline vision attachment ("Importer une image" / "Prendre une photo" in the
// composer) — the client (app/dashboard/(shell)/assistant/page.tsx) already
// downsizes to a ~1568px long edge JPEG (Anthropic's documented vision sweet
// spot) before sending, so a legitimate upload lands far under this. The cap
// itself is deliberately conservative, not generous: Vercel enforces a hard
// ~4.5MB ceiling on the WHOLE request body for every serverless function
// (Route Handlers included) — this account for the rest of the JSON payload
// (message, history, document text) sharing that same budget. Don't raise
// this without re-checking that ceiling.
const MAX_IMAGE_BASE64_CHARS = 3_000_000; // ~2.2MB decoded
const DATA_URL_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+=*)$/i;

// Imported-document context ("Importer un PDF"). This chat has no per-course
// cache breakpoint (unlike app/api/courses/chat/route.ts's raw_text) — every
// character here is repriced on every single call, not just the first, so
// this stays far tighter than that route's 20 000-char MAX_CONTEXT_CHARS.
const MAX_DOCUMENT_CHARS = 12000;

// Merged, not replaced, for the third round running: the multilingual
// requirement (Darija/French/English) is still real and was never
// rescinded — students genuinely switch languages mid-conversation, and
// dropping it silently just because a new prompt draft didn't repeat it
// would be a real regression, not a polish. The new "senior resident"
// persona and strict formatting rules stack on top of it.
const ASSISTANT_SYSTEM_PROMPT = `You are MedArt Assistant. You MUST fluently understand and respond in Algerian Darija, French, and English depending on the user's input — medical students in Algeria switch between all three mid-conversation, and this must never break.

Your personality is a senior medical resident guiding a fellow student: professional, concise, and structured. Your role is to help them organize their studies (e.g., Cardiology, Pneumology), explain complex medical concepts simply, and provide emotional support for study stress when needed.

Your output format is strictly Academic-Clinical. Use Markdown tables for comparisons. BOLD all medical terminology. NO EMOJIS. If you use an emoji, you are violating the core directive.

GOLDEN RULE — Arabic/Darija protection: any Arabic (العربية) or Algerian Darija (الدارجة) term the student uses is SACRED when it is the actual subject of their question (a symptom name, a colloquial term for a condition, a cultural/religious reference). NEVER silently translate such a term away — keep and use their exact Arabic/Darija wording in your reply, even while the surrounding sentence is in French or English.`;

/** Appended as its own (uncached) system turn — kept OUT of ASSISTANT_SYSTEM_PROMPT above so that block stays byte-identical across every call and keeps benefiting from Anthropic's prompt caching (see this file's cache_control comment); only two values ever exist (fr/en), so this alone would barely dent the cache hit rate even if it WERE merged in, but there's no reason to pay that cost at all. */
function buildLanguageDirective(language: "fr" | "en"): string {
  return language === "en"
    ? "Respond in English by default for this conversation, unless the student's own message is in French, Darija, or Arabic — then follow their language per the rules above."
    : "Réponds en français par défaut pour cette conversation, sauf si le message de l'étudiant est en anglais, darija ou arabe — dans ce cas, suis ses propres mots selon les règles ci-dessus.";
}

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

function isHistoryTurn(value: unknown): value is HistoryTurn {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
}

interface InlineImageAttachment {
  dataUrl: string;
  fileName?: string;
}

function isInlineImageAttachment(value: unknown): value is InlineImageAttachment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.dataUrl === "string" && (candidate.fileName === undefined || typeof candidate.fileName === "string");
}

interface DocumentAttachment {
  fileName: string;
  text: string;
}

function isDocumentAttachment(value: unknown): value is DocumentAttachment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.fileName === "string" && typeof candidate.text === "string";
}

/**
 * A content "part" shaped like OpenAI's (and, by extension, OpenRouter's)
 * multimodal vision format — `{ type: "image_url", image_url: { url } }`
 * alongside a plain text part. lib/ai/openrouter.ts's own `ContentBlock`
 * type only declares `type: "text"` and is OUT of this mission's file
 * perimeter (locked to only this route + the assistant page), so it can't be
 * widened here. OpenRouter/Anthropic accept this shape over the wire
 * regardless of that stricter local TS type — streamOpenRouter only
 * JSON.stringifies whatever `messages` array it's given, it never inspects
 * the content shape — so casting through this type at the one call site
 * below (buildUserMessage) is a safe, contained way to send an image
 * without touching that shared file.
 */
type VisionContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Builds the final (current-turn) user message — plain text, or a multimodal text+image part when an inline image attachment was sent alongside it. */
function buildUserMessage(message: string, image: InlineImageAttachment | null): ChatMessageInput {
  if (!image) return { role: "user", content: message };
  const parts: VisionContentPart[] = [
    { type: "text", text: message },
    { type: "image_url", image_url: { url: image.dataUrl } },
  ];
  return { role: "user", content: parts } as unknown as ChatMessageInput;
}

interface AcademicProfileRow {
  academic_year_id: number | null;
  curriculum_specialties: { name: string } | null;
  curriculum_academic_years: { name: string } | null;
}

interface AcademicContext {
  directive: string | null;
  /** Unused by this route's own caller since semantic caching was removed — kept on the return shape as a harmless leftover rather than restructuring every return statement below for a cosmetic-only cleanup. */
  academicYearId: number | null;
}

/**
 * "Cet(te) étudiant(e) est en {année} de {spécialité}" — same specialty_id /
 * academic_year_id relation already exposed by app/api/profile/route.ts
 * (GET), reused here read-only so the assistant's clinical depth/vocabulary
 * can adapt to the student's actual curriculum level. Appended as its own
 * (uncached) system turn, same pattern as buildLanguageDirective below —
 * ASSISTANT_SYSTEM_PROMPT itself must stay byte-identical across every
 * student to keep benefiting from prompt caching, and this varies per user.
 *
 * Fails open on every edge (Supabase down, no row yet, query error): a
 * student who hasn't picked a specialty/year yet, or a transient DB hiccup,
 * must never block the chat — it just proceeds without the extra context,
 * same as ASSISTANT_SYSTEM_PROMPT always did before this existed.
 */
async function buildAcademicContext(userId: string): Promise<AcademicContext> {
  if (!isSupabaseConfigured()) return { directive: null, academicYearId: null };
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("profiles")
      .select("academic_year_id, curriculum_specialties(name), curriculum_academic_years(name)")
      .eq("id", userId)
      .maybeSingle<AcademicProfileRow>();

    if (error) {
      console.error("[assistant] Échec de lecture du profil académique (non bloquant):", error.message);
      return { directive: null, academicYearId: null };
    }

    const academicYearId = data?.academic_year_id ?? null;
    const specialty = data?.curriculum_specialties?.name;
    const year = data?.curriculum_academic_years?.name;
    if (!specialty && !year) return { directive: null, academicYearId };

    const who = specialty && year ? `${year} de ${specialty}` : (year ?? specialty);
    const directive = `Contexte académique (à ne mentionner explicitement que si on te le demande) : cet(te) étudiant(e) est en ${who}. Adapte le niveau clinique de tes réponses en conséquence — terminologie, profondeur, exemples.`;
    return { directive, academicYearId };
  } catch (error) {
    console.error("[assistant] Échec de récupération du profil académique (non bloquant):", error);
    return { directive: null, academicYearId: null };
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`assistant:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { message, history, language, image, document } = (body ?? {}) as {
    message?: unknown;
    history?: unknown;
    language?: unknown;
    image?: unknown;
    document?: unknown;
  };

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Le champ 'message' est requis." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `Message trop long (max ${MAX_MESSAGE_CHARS} caractères).` }, { status: 413 });
  }

  // Optional inline vision attachment — "Importer une image" / "Prendre une
  // photo" in the composer (see ATTACHMENT_ITEMS in the assistant page).
  let imageAttachment: InlineImageAttachment | null = null;
  if (image !== undefined) {
    if (!isInlineImageAttachment(image)) {
      return NextResponse.json({ error: "Pièce jointe image invalide." }, { status: 400 });
    }
    const match = DATA_URL_IMAGE_PATTERN.exec(image.dataUrl);
    if (!match) {
      return NextResponse.json({ error: "Format d'image non supporté (PNG, JPEG, WEBP ou GIF attendu)." }, { status: 400 });
    }
    if (match[2].length > MAX_IMAGE_BASE64_CHARS) {
      return NextResponse.json({ error: "Image trop volumineuse." }, { status: 413 });
    }
    imageAttachment = image;
  }

  // Optional imported-document context — "Importer un PDF" in the composer.
  // The client already extracted the text (via /api/upload, the same
  // officeparser-backed pipeline the rest of the app uses) before this call;
  // this route only validates shape/size and folds it into the prompt.
  let documentAttachment: DocumentAttachment | null = null;
  if (document !== undefined) {
    if (!isDocumentAttachment(document)) {
      return NextResponse.json({ error: "Document invalide." }, { status: 400 });
    }
    documentAttachment = { fileName: document.fileName.slice(0, 200), text: document.text.slice(0, MAX_DOCUMENT_CHARS) };
  }

  const activeLanguage = language === "en" ? "en" : "fr";
  const historyTurns: HistoryTurn[] = Array.isArray(history) ? history.filter(isHistoryTurn).slice(-MAX_HISTORY_MESSAGES) : [];
  const { directive: academicDirective } = await buildAcademicContext(user.id);

  const messages: ChatMessageInput[] = [
    { role: "system", content: [{ type: "text", text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }] },
    { role: "system", content: buildLanguageDirective(activeLanguage) },
    ...(academicDirective ? [{ role: "system" as const, content: academicDirective }] : []),
    ...(documentAttachment
      ? [
          {
            role: "system" as const,
            content: `Voici le contenu extrait du document que l'étudiant vient d'importer ("${documentAttachment.fileName}") — utilise-le comme contexte pour répondre à sa question ci-dessous quand c'est pertinent :\n"""\n${documentAttachment.text}\n"""`,
          },
        ]
      : []),
    ...historyTurns,
    buildUserMessage(message, imageAttachment),
  ];

  // Image attachments go straight to HAIKU_MODEL (paid) — Anthropic's own
  // confirmed vision support, not FREE_MODEL_CHAIN's unverified "multimodal"
  // catalog claim (see that constant's own comment for why). Images are a
  // minority of Assistant messages, so this still leaves the bulk of real
  // traffic (text-only) on the free tier below.
  if (imageAttachment) {
    try {
      const stream = await streamOpenRouter(messages, { model: HAIKU_MODEL, maxTokens: 2048 });
      return new NextResponse(stream, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Model-Used": HAIKU_MODEL },
      });
    } catch (error) {
      if (error instanceof OpenRouterError) {
        console.error(`[assistant] Erreur OpenRouter (status ${error.status}):`, error.message);
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error("[assistant] Erreur non gérée:", error);
      return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
  }

  // Text-only path — routed onto FREE_MODEL_CHAIN (genuinely zero marginal
  // cost), same pattern as app/api/dashboard-assistant/route.ts. This route
  // previously forced every message (image or not) onto paid HAIKU_MODEL;
  // this was a real, silent cost contributor found while investigating a
  // ~$0.04/message report. reserveFreeTierCapacity guards the free tier's
  // own hard, EXTERNAL, account-wide daily request cap — shared with every
  // other free-tier caller, so it must be reserved here too, not assumed
  // available. Never falls back to a paid model if every free one fails:
  // that would silently defeat the entire point of this tier.
  const capacity = await reserveFreeTierCapacity();
  if (!capacity.allowed) {
    return NextResponse.json({ error: capacity.reason }, { status: 503 });
  }

  let lastError: unknown = null;
  for (const model of FREE_MODEL_CHAIN) {
    try {
      const stream = await streamOpenRouter(messages, { model, maxTokens: 2048 });
      return new NextResponse(stream, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Model-Used": model },
      });
    } catch (error) {
      lastError = error;
      console.error(`[assistant] Modèle gratuit "${model}" indisponible, bascule sur le suivant:`, error instanceof Error ? error.message : error);
    }
  }

  const status = lastError instanceof OpenRouterError ? lastError.status : 503;
  console.error("[assistant] Tous les modèles gratuits ont échoué:", lastError instanceof Error ? lastError.message : lastError);
  return NextResponse.json(
    { error: "L'assistant est momentanément indisponible (forte demande) — réessaie dans une minute." },
    { status: status >= 400 && status < 600 ? status : 503 }
  );
}
