import { callOpenRouter, CHAT_MODEL, generateOpenRouterImage, PRIMARY_FREE_OMNI, type ChatMessageInput, type OpenRouterResponseFormat } from "@/lib/ai/openrouter";
import { FREE_OMNI_MAX_TOKENS } from "@/lib/ai/omni-routing";
import { runThroughLedger } from "@/lib/ai/generation-ledger";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { reserveFreeTierCapacity } from "@/lib/platform-spend-guard";
import { FICHE_SYNTHESE_VERSION } from "@/lib/infographic-fiche-key";

/**
 * STUDIO "INFOGRAPHIE / FICHE DE SYNTHÈSE" — product order 2026-11-09.
 *
 * Two steps, each its own route:
 *  1. app/api/studio/infographic/prompt — a TEXT model reads the course and
 *     extracts its plan: one title, one core topic (with the drawings it
 *     calls for) and exactly six key sub-topics. The code — never the model —
 *     pours them into the strict image prompt (buildFicheSynthesePrompt).
 *     Free PRIMARY_FREE_OMNI first; if it fails, ultra-cheap fallbacks
 *     (Llama 3.1 8B held to a strict JSON schema, then qwen3.7-flash in JSON
 *     mode — a small fraction of a cent per course); if every model fails, a
 *     plan built from the course's own headings. The step cannot fail.
 *  2. app/api/studio/infographic — that prompt goes to the image model
 *     (FICHE_IMAGE_MODELS); the image is stored and shown in the Studio.
 * The plan is kept in the generation ledger, so step 2 reuses step 1's plan
 * for 0 tokens. The image route never takes a prompt from the browser.
 */

/** Number of key sub-topics — one box each on the sheet. */
export const FICHE_TOPIC_COUNT = 6;

/**
 * Image models, in order. NO "Muse" model on OpenRouter generates images
 * (checked live 2026-11-09: every meta/muse-* model outputs text only), so
 * the sheet uses the app's designated image backend — Nano Banana 2 (Gemini
 * 3.1 Flash Image) — then its preview id, the one the shelved Infographie
 * validated in production (2026-09-02), if the first fails.
 */
export const FICHE_IMAGE_MODELS = ["google/gemini-3.1-flash-image", "google/gemini-3.1-flash-image-preview"] as const;

/** The ultra-cheap extraction fallback ($0.02 / $0.04 per million tokens), held to a strict JSON schema. */
export const FICHE_OUTLINE_CHEAP_MODEL = "meta-llama/llama-3.1-8b-instruct";

/** Course text given to the extraction (same excerpt size as the shelved Infographie's). */
export const MAX_SOURCE_CHARS_FOR_FICHE = 20_000;

const OMNI_OUTLINE_TIMEOUT_MS = 45_000;
const CHEAP_OUTLINE_TIMEOUT_MS = 25_000;
/** One image attempt. A real Nano Banana 2 generation took ~10 s (2026-09-02). */
const IMAGE_ATTEMPT_TIMEOUT_MS = 110_000;
/** A second image model is only worth trying with at least this much time left. */
const MIN_IMAGE_ATTEMPT_MS = 30_000;
/**
 * A plan built from the course's headings (every model failed) is kept this
 * long — enough for the image step that follows to reuse it instead of
 * re-running the failed models — then retried with the models.
 */
const HEADINGS_PLAN_REUSE_MS = 15 * 60_000;

export interface FicheTopic {
  /** The box's heading, in French. */
  heading: string;
  /** Its key points, in French (empty for a plan built from the course's headings). */
  details: string;
}

export interface FicheOutline {
  /** The sheet's title, in French. */
  title: string;
  /** The core medical topic, in English (it sits in the English image prompt). */
  coreTopic: string;
  /** Specific anatomical / medical drawings for that topic, in English. */
  illustrations: string[];
  /** Exactly FICHE_TOPIC_COUNT boxes. */
  topics: FicheTopic[];
}

/** Who produced the plan: the free Omni model, a cheap fallback, or the course's own headings (no model). */
export type FicheOutlineSource = "omni" | "fallback" | "course-headings";

/** Key of the sheet's caches (shared image cache, stored file, ledger): the sheet version + the normalized course text. */
export function ficheContentHash(sourceText: string): string {
  return sha256(`${FICHE_SYNTHESE_VERSION}:${normalizeText(sourceText)}`);
}

// ─── the strict image prompt ───────────────────────────────────────────────

/** The product's strict template (wording fixed by product order 2026-11-09), filled with the extracted plan. */
export function buildFicheSynthesePrompt(outline: FicheOutline): string {
  const examples = outline.illustrations.length > 0 ? ` (e.g., ${outline.illustrations.join(", ")})` : "";
  const boxes = outline.topics.map((topic, index) => `${index + 1}. "${topic.heading}"${topic.details ? ` (${topic.details})` : ""}.`).join("\n");
  return [
    `An ultra-detailed, highly illustrated medical cheat sheet (Fiche de synthèse) titled "${outline.title}".`,
    "Layout & Structure: A highly organized, multi-column grid layout with distinct rectangular text boxes on a soft pastel background.",
    `Visual Elements: CRITICAL - Do not just use basic icons. You MUST integrate an overwhelming abundance of vivid, detailed anatomical and medical illustrations within, around, and between the text boxes related to ${outline.coreTopic}${examples}.`,
    "Content & Typography: Packed with maximum clinical details, exhaustive sub-points, and scientific precision. All text must be in professional French, placed inside the pastel text boxes with crystal clear, legible typography. Zero blurry text, zero gibberish.",
    "Include detailed boxes for:",
    boxes,
    "Style: Aesthetic digital medical notes merged with a masterclass anatomical textbook, dense information, soft pastel text boxes combined with hyper-realistic medical drawings, 8k resolution, professional clinical education vector style.",
  ].join("\n");
}

// ─── extraction ────────────────────────────────────────────────────────────

/** The product's own reference ("Type 2 Diabetes"), as the plan the model must return for it. */
const REFERENCE_OUTLINE: FicheOutline = {
  title: "LE DIABÈTE DE TYPE 2 : Physiopathologie & Métabolisme Endocrinien",
  coreTopic: "type 2 diabetes and glucose metabolism",
  illustrations: [
    "pancreas cross-section",
    "islets of Langerhans",
    "beta cells",
    "insulin binding to cellular receptors",
    "glucose molecules entering cells",
    "blood vessels with high glucose",
  ],
  topics: [
    { heading: "Définition & Épidémiologie", details: "Trouble métabolique chronique, hyperglycémie, facteurs de risque: obésité, sédentarité" },
    { heading: "Physiopathologie", details: "Insulino-résistance tissulaire, épuisement pancréatique, déficit insulino-sécrétoire, glucotoxicité" },
    { heading: "Signes Cliniques", details: "Souvent asymptomatique, asthénie, syndrome polyuro-polydipsique, vision trouble" },
    { heading: "Diagnostic Biologique", details: "Glycémie à jeun ≥ 1.26 g/L, HbA1c ≥ 6.5%, HGPO" },
    { heading: "Complications", details: "Microangiopathie: rétinopathie, néphropathie. Macroangiopathie: IDM, AVC. Neuropathie" },
    { heading: "Traitement & Prise en charge", details: "Règles hygiéno-diététiques, Metformine, analogues GLP-1, inhibiteurs SGLT2, Insulinothérapie" },
  ],
};

const OUTLINE_SYSTEM_PROMPT = `You extract the plan of a one-page illustrated medical cheat sheet ("Fiche de synthèse") from a medical course. Your ONLY job is to return ONE JSON object and nothing else — no markdown fence, no comment.

JSON shape (exactly these keys):
{"title": string, "coreTopic": string, "illustrations": string[], "topics": [{"heading": string, "details": string}]}

Rules:
- "title": in FRENCH. The course's exact subject in UPPERCASE, optionally followed by " : " and a short subtitle naming its angle (as in the example). Keep the course's own subject — never another disease or topic.
- "coreTopic": in ENGLISH, the core medical topic in a few words.
- "illustrations": in ENGLISH, 4 to 6 specific anatomical or medical drawings that fit THIS course (organs, structures, cells, mechanisms) — never generic words like "icons".
- "topics": EXACTLY ${FICHE_TOPIC_COUNT} key sub-topics covering the course in a logical clinical order (for a disease typically: definition & epidemiology, pathophysiology, clinical signs, diagnosis, complications, treatment — adapt to what THIS course actually covers). Each "heading" in FRENCH, 2 to 6 words. Each "details" in FRENCH: 3 to 6 key facts taken from the course, comma-separated, at most 200 characters, precise (values, thresholds, drug names) — only facts present in the course, never invented.
- Never use double quotes inside a value.

Example — the expected output for a course on type 2 diabetes:
${JSON.stringify(REFERENCE_OUTLINE)}`;

/** A course title is its uploaded file's name: "Diabète_type_2.pdf" → "Diabète type 2". */
export function courseSubject(courseTitle: string): string {
  return courseTitle
    .replace(/\.(pdf|docx?|pptx?|txt|md|rtf|odt)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOutlineMessages(courseTitle: string, sourceText: string): ChatMessageInput[] {
  return [
    { role: "system", content: OUTLINE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Course title: "${courseSubject(courseTitle)}"\n\nCourse content:\n"""\n${sourceText.slice(0, MAX_SOURCE_CHARS_FOR_FICHE)}\n"""\n\nReturn the JSON object now.`,
    },
  ];
}

/** Strict JSON schema for the cheap fallback (structured outputs). Array lengths are checked in code (parseFicheOutline). */
const OUTLINE_JSON_SCHEMA: OpenRouterResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "fiche_outline",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "coreTopic", "illustrations", "topics"],
      properties: {
        title: { type: "string" },
        coreTopic: { type: "string" },
        illustrations: { type: "array", items: { type: "string" } },
        topics: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["heading", "details"],
            properties: { heading: { type: "string" }, details: { type: "string" } },
          },
        },
      },
    },
  },
};

/** One line of prompt-safe text: no control characters or line breaks, no double quotes (they delimit values in the prompt), single spaces, capped at a word boundary. */
function cleanField(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 32;
    text += code < 32 || code === 127 ? " " : char;
  }
  text = text
    .replace(/["“”«»„]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  return (lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak) : cut).trim();
}

/** Trailing punctuation the template adds itself (each box ends with its own "." after the parenthesis). */
function trimTrailingPunctuation(text: string): string {
  return text.replace(/[\s.;:,!]+$/u, "");
}

const GENERIC_ILLUSTRATIONS = [
  "detailed anatomical cross-sections",
  "organ and tissue illustrations",
  "cellular and molecular mechanisms",
  "clinical examination scenes",
  "medical imaging",
  "treatment and pharmacology diagrams",
];

/**
 * A model's answer → a valid plan, or null. Tolerates a code fence, text
 * around the object and close key names; requires a title and at least
 * FICHE_TOPIC_COUNT distinct topics with a heading (only the first ones are kept).
 */
export function parseFicheOutline(raw: string): FicheOutline | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  const title = trimTrailingPunctuation(cleanField(record.title, 140));
  if (!title) return null;

  const rawTopics = Array.isArray(record.topics) ? record.topics : [];
  const topics: FicheTopic[] = [];
  for (const item of rawTopics) {
    if (!item || typeof item !== "object") continue;
    const topic = item as Record<string, unknown>;
    const heading = trimTrailingPunctuation(cleanField(topic.heading ?? topic.title ?? topic.name, 70));
    const rawDetails = Array.isArray(topic.details)
      ? topic.details.filter((detail): detail is string => typeof detail === "string").join(", ")
      : topic.details ?? topic.points ?? topic.description;
    const details = trimTrailingPunctuation(cleanField(rawDetails, 260));
    if (heading && !topics.some((existing) => existing.heading.toLowerCase() === heading.toLowerCase())) topics.push({ heading, details });
    if (topics.length === FICHE_TOPIC_COUNT) break;
  }
  if (topics.length < FICHE_TOPIC_COUNT) return null;

  const coreTopic = trimTrailingPunctuation(cleanField(record.coreTopic, 140)) || title;
  const illustrations = (Array.isArray(record.illustrations) ? record.illustrations : [])
    .map((value) => trimTrailingPunctuation(cleanField(value, 70)))
    .filter(Boolean)
    .slice(0, 6);

  return { title, coreTopic, illustrations: illustrations.length >= 3 ? illustrations : GENERIC_ILLUSTRATIONS, topics };
}

const STANDARD_HEADINGS = ["Définition & Épidémiologie", "Physiopathologie", "Signes Cliniques", "Diagnostic", "Complications", "Traitement & Prise en charge"];

/**
 * The plan without any model: the course's own section headings (Markdown
 * "##" / "###" of its Explication) when it has six, else the standard
 * clinical outline. The last resort that keeps the step from ever failing.
 */
export function defaultFicheOutline(courseTitle: string, sourceText: string): FicheOutline {
  const subject = trimTrailingPunctuation(cleanField(courseSubject(courseTitle), 120)) || "Cours de médecine";
  const headings: string[] = [];
  for (const match of sourceText.matchAll(/^#{2,3}\s+(.+)$/gm)) {
    const heading = trimTrailingPunctuation(
      cleanField(
        match[1]
          .replace(/[*_`#]/g, "")
          .replace(/^(?:\d+|[IVXLC]+)\s*[.)\-–—:]\s*/i, "")
          .replace(/^(?:partie|chapitre|section)\s+(?:\d+|[IVXLC]+)\s*[:.\-–—]\s*/i, ""),
        70
      )
    );
    if (heading && !headings.some((existing) => existing.toLowerCase() === heading.toLowerCase())) headings.push(heading);
    if (headings.length === FICHE_TOPIC_COUNT) break;
  }
  const chosen = headings.length === FICHE_TOPIC_COUNT ? headings : STANDARD_HEADINGS;
  return {
    title: subject.toLocaleUpperCase("fr-FR"),
    coreTopic: subject,
    illustrations: GENERIC_ILLUSTRATIONS,
    topics: chosen.map((heading) => ({ heading, details: "" })),
  };
}

interface StoredOutline {
  outline: FicheOutline;
  source: FicheOutlineSource;
  /** When the plan was made (ms). */
  at: number;
}

function isStoredOutline(value: unknown): value is StoredOutline {
  if (!value || typeof value !== "object") return false;
  const { outline, source, at } = value as Partial<StoredOutline>;
  const wellFormed =
    !!outline &&
    typeof outline.title === "string" &&
    typeof outline.coreTopic === "string" &&
    Array.isArray(outline.illustrations) &&
    Array.isArray(outline.topics) &&
    outline.topics.length === FICHE_TOPIC_COUNT;
  if (!wellFormed) return false;
  if (source === "omni" || source === "fallback") return true;
  return source === "course-headings" && typeof at === "number" && Date.now() - at < HEADINGS_PLAN_REUSE_MS;
}

type OutlineCallOptions = NonNullable<Parameters<typeof callOpenRouter>[1]>;

/** Free Omni first, then the cheap fallbacks; throws only when every model failed. */
async function extractWithModels(courseTitle: string, sourceText: string): Promise<{ outline: FicheOutline; source: FicheOutlineSource }> {
  const messages = buildOutlineMessages(courseTitle, sourceText);
  let lastError: unknown = null;

  // One request on the shared free-tier daily ceiling (lib/platform-spend-guard.ts).
  const capacity = await reserveFreeTierCapacity();
  if (capacity.allowed) {
    try {
      const outline = parseFicheOutline(
        await callOpenRouter(messages, {
          model: PRIMARY_FREE_OMNI,
          maxTokens: FREE_OMNI_MAX_TOKENS,
          temperature: 0.2,
          reasoning: { effort: "low" },
          timeoutMs: OMNI_OUTLINE_TIMEOUT_MS,
          bypassMock: true,
        })
      );
      if (outline) return { outline, source: "omni" };
      lastError = new Error("Omni : plan illisible.");
    } catch (error) {
      lastError = error;
    }
    console.error("[infographic-sheet] Omni gratuit sans plan valide, bascule sur le repli économique:", lastError instanceof Error ? lastError.message : lastError);
  }

  const cheapAttempts: OutlineCallOptions[] = [
    // Strict JSON schema (structured outputs): the answer is the object, by construction.
    { model: FICHE_OUTLINE_CHEAP_MODEL, maxTokens: 1500, temperature: 0.2, responseFormat: OUTLINE_JSON_SCHEMA, timeoutMs: CHEAP_OUTLINE_TIMEOUT_MS, bypassMock: true },
    // The Copilot's own model (hybrid thinking: reasoning OFF), JSON mode.
    { model: CHAT_MODEL, maxTokens: 1500, temperature: 0.2, reasoning: { enabled: false }, responseFormat: { type: "json_object" }, timeoutMs: CHEAP_OUTLINE_TIMEOUT_MS, bypassMock: true },
  ];
  for (const options of cheapAttempts) {
    try {
      const outline = parseFicheOutline(await callOpenRouter(messages, options));
      if (outline) return { outline, source: "fallback" };
      lastError = new Error(`${options.model} : plan illisible.`);
    } catch (error) {
      lastError = error;
    }
    console.error(`[infographic-sheet] Repli "${options.model}" sans plan valide:`, lastError instanceof Error ? lastError.message : lastError);
  }
  throw lastError instanceof Error ? lastError : new Error("Aucun modèle n'a produit de plan.");
}

/**
 * Step 1: the sheet's plan for one course text. Kept in the generation ledger
 * by text (shared by every student with the same course, like the image), so
 * the image step gets it for 0 tokens. Never throws: when every model fails,
 * the plan comes from the course's own headings — kept only
 * HEADINGS_PLAN_REUSE_MS, so the models are tried again later.
 */
export async function extractFicheOutline(input: { courseTitle: string; sourceText: string; contentHash: string }): Promise<{ outline: FicheOutline; source: FicheOutlineSource }> {
  const headingsPlan = (): StoredOutline => ({ outline: defaultFicheOutline(input.courseTitle, input.sourceText), source: "course-headings", at: Date.now() });
  try {
    const stored = await runThroughLedger<StoredOutline>(
      {
        namespace: "infographic-fiche-outline",
        key: { version: FICHE_SYNTHESE_VERSION, contentHash: input.contentHash },
        peerWaitMs: 60_000,
        leaseMs: 120_000,
        isValid: isStoredOutline,
      },
      async () => {
        try {
          return { ...(await extractWithModels(input.courseTitle, input.sourceText)), at: Date.now() };
        } catch (error) {
          console.error("[infographic-sheet] Plan construit depuis les titres du cours (aucun modèle disponible):", error instanceof Error ? error.message : error);
          return headingsPlan();
        }
      }
    );
    return { outline: stored.outline, source: stored.source };
  } catch (error) {
    // The ledger is fail-open by design; this is only a last guard so the step never fails.
    console.error("[infographic-sheet] Ledger indisponible pour le plan:", error instanceof Error ? error.message : error);
    const fallback = headingsPlan();
    return { outline: fallback.outline, source: fallback.source };
  }
}

/**
 * Step 2: the image for a finished prompt — FICHE_IMAGE_MODELS in order, each
 * attempt bounded by `deadline` (epoch ms) so the route always answers within
 * its own duration. Throws the last error when no model produced an image.
 */
export async function generateFicheImage(prompt: string, deadline: number): Promise<{ imageDataUrl: string; model: string }> {
  let lastError: unknown = null;
  for (const [index, model] of FICHE_IMAGE_MODELS.entries()) {
    const remaining = deadline - Date.now();
    if (index > 0 && remaining < MIN_IMAGE_ATTEMPT_MS) break;
    try {
      const { imageDataUrl } = await generateOpenRouterImage([{ role: "user", content: prompt }], {
        model,
        timeoutMs: Math.max(MIN_IMAGE_ATTEMPT_MS, Math.min(IMAGE_ATTEMPT_TIMEOUT_MS, remaining)),
      });
      return { imageDataUrl, model };
    } catch (error) {
      lastError = error;
      console.error(`[infographic-sheet] Modèle d'image "${model}" sans image:`, error instanceof Error ? error.message : error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Aucun modèle d'image n'a répondu.");
}
