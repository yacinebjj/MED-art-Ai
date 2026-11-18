import { callOpenRouterChain } from "@/lib/ai/call-resilient";
import { FLASHCARD_MODEL, STUDIO_MODEL } from "@/lib/ai/openrouter";
import { STUDIO_BYPASS_MOCK, STUDIO_PROMPT_CONFIG, buildStudioSystemMessage } from "@/lib/ai/studio-prompts";
import { RESUME_PART_INSTRUCTIONS, RESUME_PART_MAX_TOKENS, type ResumePartId } from "@/lib/ai/studio-resume-prompts";
import { StudioResumeSchema } from "@/lib/ai/studio-schemas";
import { parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import type {
  GastriteDdxTable,
  GastriteGuidelineStep,
  GastritePieges,
  GastriteResumeCard,
  GastriteResumeHero,
  GastriteResumeMode,
  GastriteResumeSection,
  GastriteResumeTable,
} from "@/lib/course-slug-content";

/**
 * Studio « Résumé » — built from FOUR parallel calls instead of one
 * (product order 2026-11-18: « Astuces » and « Cheat Sheet » removed, Exam
 * Summary rebuilt on the QCM « annales DNA », Smart Summary and Guideline
 * Summary made far deeper; 2026-11-19: « Professor Notes » removed too).
 *
 * Why parallel: the deeper Résumé is ~10k output tokens. STUDIO_MODEL
 * (Qwen3-235B, ~38-70 tok/s) writing it in one call would need 3-4 minutes —
 * past the route's 250 s generation budget. Four parts of ~2-4k tokens run
 * side by side, so the whole Résumé lands in roughly the time of the longest
 * part. Same pattern as the 30-question QCM set (lib/ai/studio-qcm.ts): each
 * part is its own model chain (STUDIO_MODEL, then the much faster
 * FLASHCARD_MODEL) under the shared deadline, with its own generation-ledger
 * entry — when one part fails and the student clicks again, the parts that
 * already succeeded are replayed for free.
 *
 * Parts: Smart Summary sections 1-5 (+ its title), Smart Summary sections
 * 6-10, Exam Summary, Guideline Summary. Each answers a small natural JSON
 * object (lib/ai/studio-resume-prompts.ts); the code below
 * normalizes it and maps it onto the GastriteResumeMode shape the Studio
 * renders (components/course/workspace/GastriteResumeStudio.tsx).
 */

type Json = Record<string, unknown>;

export interface StudioResumeSet {
  tombabilite: number;
  modes: GastriteResumeMode[];
}

// ─── text helpers ──────────────────────────────────────────────────────────

/** A trimmed one-line string (newlines kept, one per line, when `multiline`); "" for anything else. */
export function cleanText(value: unknown, multiline = false): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  if (!multiline) return value.replace(/\s+/g, " ").trim();
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Up to `max` non-empty strings (an object item contributes its text / texte / point field). */
function textList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text =
      typeof item === "string" || typeof item === "number"
        ? cleanText(item)
        : item && typeof item === "object"
          ? cleanText((item as Json).text ?? (item as Json).texte ?? (item as Json).point)
          : "";
    if (text) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Up to `max` plain objects. */
function objectList(value: unknown, max: number): Json[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Json => !!item && typeof item === "object" && !Array.isArray(item)).slice(0, max);
}

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}

const EMPTY_TABLE: GastriteResumeTable = { headers: [], rows: [] };

/** Headers + rows, each row cut or padded to the headers; empty when there are no headers or no non-empty row. */
function normalizeTable(value: unknown, maxRows: number): GastriteResumeTable {
  const raw = asObject(value);
  const headers = textList(raw.headers, 6);
  if (headers.length === 0) return { ...EMPTY_TABLE };
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => headers.map((_, index) => cleanText(row[index])))
    .filter((row) => row.some(Boolean))
    .slice(0, maxRows);
  return rows.length > 0 ? { headers, rows } : { ...EMPTY_TABLE };
}

function normalizeCard(value: Json): GastriteResumeCard | null {
  const titre = cleanText(value.titre ?? value.title);
  const content = cleanText(value.content ?? value.contenu ?? value.texte);
  const items = textList(value.items ?? value.points, 12);
  if (!content && items.length === 0) return null;
  const type = value.type === "list" || (items.length > 0 && !content) ? "list" : "text";
  return { titre, type, content, items };
}

function normalizeSection(value: Json, numero: number): GastriteResumeSection {
  return {
    numero,
    titre: cleanText(value.titre ?? value.title),
    intro: cleanText(value.intro),
    outro: cleanText(value.outro ?? value.conclusion),
    cards: objectList(value.cards, 8).map(normalizeCard).filter(nonNull),
    table: normalizeTable(value.table, 14),
    rows: objectList(value.rows, 10)
      .map((row) => ({ label: cleanText(row.label), badge: cleanText(row.badge) }))
      .filter((row) => row.label),
    items: textList(value.items, 14),
  };
}

function sectionHasContent(section: GastriteResumeSection): boolean {
  return section.cards.length > 0 || section.table.rows.length > 0 || section.rows.length > 0 || section.items.length > 0;
}

/** The part's JSON object: fences / text around it tolerated, Postgres-unsafe control characters stripped. */
function parsePartObject(raw: string): Json {
  return asObject(sanitizeForPostgres(parseJsonResponse(raw)));
}

// ─── the five parts ────────────────────────────────────────────────────────

export interface SmartFirstHalf {
  hero: { titre: string; tags: string[]; intro: string };
  sections: GastriteResumeSection[];
}

export function parseSmartFirstHalf(raw: string): SmartFirstHalf {
  const data = parsePartObject(raw);
  const hero = asObject(data.hero);
  const sections = objectList(data.sections, 5).map((section, index) => normalizeSection(section, index + 1));
  if (sections.length < 5 || !sections.every((section) => section.titre && sectionHasContent(section))) {
    throw new Error(`Smart Summary (1-5) incomplet : ${sections.filter((s) => s.titre && sectionHasContent(s)).length}/5 sections complètes.`);
  }
  return {
    hero: { titre: cleanText(hero.titre ?? hero.title) || "MASTERCLASS", tags: textList(hero.tags, 3), intro: cleanText(hero.intro) },
    sections,
  };
}

export interface SmartSecondHalf {
  sections: GastriteResumeSection[];
}

export function parseSmartSecondHalf(raw: string): SmartSecondHalf {
  const data = parsePartObject(raw);
  const sections = objectList(data.sections, 5)
    .map((section, index) => normalizeSection(section, index + 6))
    .filter((section) => section.titre && sectionHasContent(section));
  if (sections.length < 4) throw new Error(`Smart Summary (6-10) incomplet : ${sections.length}/5 sections complètes.`);
  return { sections };
}

/** The seven trap families of the QCM « annales DNA » (lib/ai/studio-prompts.ts), in display order. */
export const EXAM_TRAP_FAMILIES = ["conditionnalite", "inversion", "absolus", "iatrogenie", "fausse_piste", "escalade", "calcul"] as const;
export type ExamTrapFamily = (typeof EXAM_TRAP_FAMILIES)[number];

function trapFamily(value: unknown): ExamTrapFamily | "autre" {
  const key = cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_");
  if ((EXAM_TRAP_FAMILIES as readonly string[]).includes(key)) return key as ExamTrapFamily;
  if (key.startsWith("condition")) return "conditionnalite";
  if (key.startsWith("invers")) return "inversion";
  if (key.startsWith("absolu")) return "absolus";
  if (key.startsWith("iatrog") || key.startsWith("maladie")) return "iatrogenie";
  if (key.startsWith("fausse") || key.startsWith("piste")) return "fausse_piste";
  if (key.startsWith("escal")) return "escalade";
  if (key.startsWith("calcul") || key.startsWith("valeur")) return "calcul";
  return "autre";
}

function verdictOf(value: unknown): "VRAI" | "FAUX" | "TRUE" | "FALSE" | null {
  const word = cleanText(value).toUpperCase().replace(/[^A-Z]/g, "");
  return word === "VRAI" || word === "FAUX" || word === "TRUE" || word === "FALSE" ? word : null;
}

export interface ExamPart {
  tombabilite: number;
  intro: string;
  seuils: { parametre: string; seuil: string; condition: string; piege: string }[];
  pieges: { famille: ExamTrapFamily | "autre"; proposition: string; verdict: "VRAI" | "FAUX" | "TRUE" | "FALSE" | null; pourquoi: string }[];
  absolusVrais: string[];
  absolusFaux: string[];
  escalade: { etape: string; detail: string }[];
  faussesPistes: { piste: string; pourquoiElleTente: string; ceQuiTranche: string }[];
}

export function parseExamPart(raw: string): ExamPart {
  const data = parsePartObject(raw);
  const score = typeof data.tombabilite === "number" ? data.tombabilite : Number.parseFloat(cleanText(data.tombabilite));
  if (!Number.isFinite(score)) throw new Error("Exam Summary : « tombabilite » absente.");
  const pieges = objectList(data.pieges, 24)
    .map((item) => ({
      famille: trapFamily(item.famille),
      proposition: cleanText(item.proposition ?? item.piege ?? item.text),
      verdict: verdictOf(item.verdict),
      pourquoi: cleanText(item.pourquoi ?? item.explication),
    }))
    .filter((item) => item.proposition && item.pourquoi);
  if (pieges.length < 6) throw new Error(`Exam Summary incomplet : ${pieges.length} pièges valides (6 au moins).`);
  return {
    tombabilite: Math.round(Math.min(100, Math.max(0, score))),
    intro: cleanText(data.intro),
    seuils: objectList(data.seuils, 16)
      .map((item) => ({ parametre: cleanText(item.parametre), seuil: cleanText(item.seuil), condition: cleanText(item.condition), piege: cleanText(item.piege) }))
      .filter((item) => item.parametre && item.seuil),
    pieges,
    absolusVrais: textList(data.absolus_vrais, 8),
    absolusFaux: textList(data.absolus_faux, 8),
    escalade: objectList(data.escalade, 10)
      .map((item) => ({ etape: cleanText(item.etape ?? item.titre), detail: cleanText(item.detail ?? item.contenu) }))
      .filter((item) => item.etape && item.detail),
    faussesPistes: objectList(data.fausses_pistes, 8)
      .map((item) => ({ piste: cleanText(item.piste), pourquoiElleTente: cleanText(item.pourquoi_elle_tente), ceQuiTranche: cleanText(item.ce_qui_tranche) }))
      .filter((item) => item.piste && item.ceQuiTranche),
  };
}

export interface GuidelinePart {
  intro: string;
  etapes: { titre: string; contenu: string }[];
  encadres: { titre: string; points: string[] }[];
}

export function parseGuidelinePart(raw: string): GuidelinePart {
  const data = parsePartObject(raw);
  const etapes = objectList(data.etapes, 16)
    .map((item) => ({ titre: cleanText(item.titre), contenu: cleanText(item.contenu ?? item.content, true) }))
    .filter((item) => item.titre && item.contenu);
  if (etapes.length < 4) throw new Error(`Guideline Summary incomplet : ${etapes.length} étapes (4 au moins).`);
  return {
    intro: cleanText(data.intro),
    etapes,
    encadres: objectList(data.encadres, 5)
      .map((item) => ({ titre: cleanText(item.titre), points: textList(item.points ?? item.items, 8) }))
      .filter((item) => item.titre && item.points.length > 0),
  };
}

// ─── assembly ──────────────────────────────────────────────────────────────

const LABELS = {
  fr: {
    examBadge: "Mode sniper",
    seuilsTitle: "Seuils exacts & conditions",
    seuilsHeaders: ["Paramètre", "Seuil exact", "Condition d'application", "Le piège"],
    piegesTitle: "Les pièges du jury",
    piegesIntro: "Chaque carte est une proposition de QCM telle que le jury la pose : son verdict, et la règle du cours qui tranche.",
    families: {
      conditionnalite: "Conditionnalité",
      inversion: "Inversion physiopathologique",
      absolus: "Mots absolus",
      iatrogenie: "Maladie ou iatrogénie",
      fausse_piste: "Fausses pistes",
      escalade: "Escalade clinique",
      calcul: "Calculs & valeurs trompeuses",
      autre: "Autres pièges",
    },
    absolusVrais: "Absolus VRAIS — le cours les affirme",
    absolusFaux: "Absolus FAUX — à rayer d'emblée",
    faussesPistesTitle: "Fausses pistes",
    faussesPistesHeaders: ["Piste", "Pourquoi elle tente", "Ce qui tranche"],
    guidelineBadge: "Parcours clinique",
  },
  en: {
    examBadge: "Sniper mode",
    seuilsTitle: "Exact thresholds & conditions",
    seuilsHeaders: ["Parameter", "Exact threshold", "Condition", "The trap"],
    piegesTitle: "The examiners' traps",
    piegesIntro: "Each card is an MCQ statement as the examiners write it: its verdict, and the rule from the course that settles it.",
    families: {
      conditionnalite: "Conditionality",
      inversion: "Pathophysiological inversion",
      absolus: "Absolute words",
      iatrogenie: "Disease or iatrogenesis",
      fausse_piste: "Red herrings",
      escalade: "Clinical escalation",
      calcul: "Calculations & misleading values",
      autre: "Other traps",
    },
    absolusVrais: "TRUE absolutes — the course states them",
    absolusFaux: "FALSE absolutes — cross them out",
    faussesPistesTitle: "Red herrings",
    faussesPistesHeaders: ["Lead", "Why it tempts", "What settles it"],
    guidelineBadge: "Clinical pathway",
  },
} as const;

type Labels = (typeof LABELS)[keyof typeof LABELS];

const EMPTY_DDX: GastriteDdxTable = { titre: "", intro: "", headers: [], rows: [] };
const EMPTY_PIEGES: GastritePieges = { titre: "", intro: "", categories: [] };

function hero(fields: Partial<GastriteResumeHero> & { titre: string }): GastriteResumeHero {
  return { tags: [], badge: "", intro: "", sous_titre: "", ...fields };
}

function baseMode(id: GastriteResumeMode["id"], label: string, heroValue: GastriteResumeHero): GastriteResumeMode {
  return {
    id,
    label,
    hero: heroValue,
    sections: [],
    ddx_table: { ...EMPTY_DDX },
    pieges: { ...EMPTY_PIEGES },
    cards: [],
    steps: [],
    quotes: [],
    perles: [],
    items: [],
  };
}

function listCard(titre: string, items: string[], tone: string): GastriteResumeCard[] {
  return items.length > 0 ? [{ titre, type: "list", tone, content: "", items }] : [];
}

/** One trap as the exam card format GastriteResumeStudio parses: `🚨 **Piège:** … ➡️ **Pourquoi ?** …` (the verdict leads the why). */
export function formatExamTrap(trap: ExamPart["pieges"][number]): string {
  const why = trap.verdict ? `**${trap.verdict}** — ${trap.pourquoi}` : trap.pourquoi;
  return `🚨 **Piège:** ${trap.proposition} ➡️ **Pourquoi ?** ${why}`;
}

export function buildSmartMode(first: SmartFirstHalf, second: SmartSecondHalf): GastriteResumeMode {
  const mode = baseMode("smart", "Smart Summary", hero({ titre: first.hero.titre, tags: first.hero.tags, intro: first.hero.intro }));
  mode.sections = [...first.sections, ...second.sections].map((section, index) => ({ ...section, numero: index + 1 }));
  return mode;
}

export function buildExamMode(part: ExamPart, labels: Labels): GastriteResumeMode {
  const mode = baseMode("exam", "Exam Summary", hero({ badge: labels.examBadge, titre: "Exam Summary", intro: part.intro }));
  if (part.seuils.length > 0) {
    mode.sections = [
      {
        numero: 1,
        titre: labels.seuilsTitle,
        intro: "",
        outro: "",
        cards: [],
        table: { headers: [...labels.seuilsHeaders], rows: part.seuils.map((s) => [s.parametre, s.seuil, s.condition, s.piege]) },
        rows: [],
        items: [],
      },
    ];
  }
  const families: (ExamTrapFamily | "autre")[] = [...EXAM_TRAP_FAMILIES, "autre"];
  mode.pieges = {
    titre: labels.piegesTitle,
    intro: labels.piegesIntro,
    categories: families
      .map((family) => ({
        nom: labels.families[family],
        items: part.pieges.filter((trap) => trap.famille === family).map((trap, index) => ({ numero: index + 1, text: formatExamTrap(trap) })),
      }))
      .filter((category) => category.items.length > 0),
  };
  mode.cards = [...listCard(labels.absolusVrais, part.absolusVrais, "emerald"), ...listCard(labels.absolusFaux, part.absolusFaux, "rose")];
  mode.steps = part.escalade.map((step, index): GastriteGuidelineStep => ({ numero: index + 1, titre: step.etape, content: step.detail }));
  if (part.faussesPistes.length > 0) {
    mode.ddx_table = {
      titre: labels.faussesPistesTitle,
      intro: "",
      headers: [...labels.faussesPistesHeaders],
      rows: part.faussesPistes.map((p) => [p.piste, p.pourquoiElleTente, p.ceQuiTranche]),
    };
  }
  return mode;
}

export function buildGuidelineMode(part: GuidelinePart, labels: Labels): GastriteResumeMode {
  const mode = baseMode("guideline", "Guideline Summary", hero({ badge: labels.guidelineBadge, titre: "Guideline Summary", intro: part.intro }));
  mode.steps = part.etapes.map((step, index): GastriteGuidelineStep => ({ numero: index + 1, titre: step.titre, content: step.contenu }));
  mode.cards = part.encadres.map((box): GastriteResumeCard => ({ titre: box.titre, type: "list", content: "", items: box.points }));
  return mode;
}

/** The three modes in the Studio's order (Smart, Exam, Guideline), validated against StudioResumeSchema. */
export function assembleStudioResume(
  parts: { smartA: SmartFirstHalf; smartB: SmartSecondHalf; exam: ExamPart; guideline: GuidelinePart },
  language: "fr" | "en"
): StudioResumeSet {
  const labels = LABELS[language];
  const set: StudioResumeSet = {
    tombabilite: parts.exam.tombabilite,
    modes: [
      buildSmartMode(parts.smartA, parts.smartB),
      buildExamMode(parts.exam, labels),
      buildGuidelineMode(parts.guideline, labels),
    ],
  };
  StudioResumeSchema.parse(set);
  return set;
}

// ─── generation ────────────────────────────────────────────────────────────

/** A replayed part (generation ledger) is trusted only with the shape its parser returns. */
const PART_LEDGER_CHECKS: Record<ResumePartId, (value: Json) => boolean> = {
  "smart-a": (value) => Array.isArray(value.sections) && value.sections.length === 5 && !!value.hero,
  "smart-b": (value) => Array.isArray(value.sections) && value.sections.length >= 4,
  exam: (value) => typeof value.tombabilite === "number" && Array.isArray(value.pieges) && value.pieges.length >= 6,
  guideline: (value) => Array.isArray(value.etapes) && value.etapes.length >= 4,
};

/**
 * Generates the whole validated Résumé. `languageInstruction` is the route's
 * own non-default-language suffix ("" for French). Throws when any part could
 * not be produced in time — the caller refunds and the student retries
 * (succeeded parts are replayed from the ledger).
 */
export async function generateStudioResumeSet(
  courseText: string,
  options: { language: "fr" | "en"; languageInstruction: string; deadlineMs: number }
): Promise<StudioResumeSet> {
  const systemContent = buildStudioSystemMessage("resume", courseText, `${STUDIO_PROMPT_CONFIG.resume.systemPrompt}${options.languageInstruction}`);

  function runPart<T>(part: ResumePartId, parse: (raw: string) => T): Promise<T> {
    return callOpenRouterChain(
      [
        { role: "system", content: systemContent },
        { role: "user", content: RESUME_PART_INSTRUCTIONS[part] },
      ],
      {
        attempts: [
          { model: STUDIO_MODEL, timeoutMs: 150_000 },
          { model: FLASHCARD_MODEL, timeoutMs: 75_000 },
          { model: FLASHCARD_MODEL, timeoutMs: 45_000 },
        ],
        maxTokens: RESUME_PART_MAX_TOKENS[part],
        deadlineMs: options.deadlineMs,
        bypassMock: STUDIO_BYPASS_MOCK,
        providerSort: "throughput",
        validate: parse,
        label: `[studio:resume ${part}]`,
        ledger: {
          namespace: "studio-resume-part",
          peerWaitMs: 90_000,
          leaseMs: 4 * 60_000,
          isValid: (value) => !!value && typeof value === "object" && PART_LEDGER_CHECKS[part](value as Json),
        },
      }
    ).then((result) => result.value);
  }

  const [smartA, smartB, exam, guideline] = await Promise.allSettled([
    runPart("smart-a", parseSmartFirstHalf),
    runPart("smart-b", parseSmartSecondHalf),
    runPart("exam", parseExamPart),
    runPart("guideline", parseGuidelinePart),
  ]);

  if (smartA.status === "rejected" || smartB.status === "rejected" || exam.status === "rejected" || guideline.status === "rejected") {
    const failed = [smartA, smartB, exam, guideline].filter((result): result is PromiseRejectedResult => result.status === "rejected");
    for (const failure of failed) console.error("[studio:resume] Partie en échec :", failure.reason);
    throw new Error(
      `${failed.length} partie(s) du Résumé sur 4 n'ont pas pu être générées à temps. Réessaie — ta génération n'a pas été décomptée et les parties déjà prêtes seront réutilisées.`
    );
  }

  return assembleStudioResume({ smartA: smartA.value, smartB: smartB.value, exam: exam.value, guideline: guideline.value }, options.language);
}
