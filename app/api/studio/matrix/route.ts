import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { callOpenRouterChain } from "@/lib/ai/call-resilient";
import { LAB_CHAIN_DEADLINE_MS, labAttempts } from "@/lib/ai/lab-generation";
import { labContentHash, labToolTypeFor, lookupLabCache, ownsLabResult, recordLabHistory, storeLabCache } from "@/lib/lab-course-cache";
import { buildLanguageDirective, parseContentLanguage } from "@/lib/ai/language-directive";
import { errorMessage, parseJsonResponse, upstreamStatusForClient } from "@/lib/course-generation-shared";
import { refundGeneration, reserveGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
// 300: the generation runs through a model fallback chain (lib/ai/lab-generation.ts)
// whose own deadline (250 s) leaves room for the DB reads and the cache write.
export const maxDuration = 300;

type MatrixKind = "pharmaco" | "ddx";

const MATRIX_KINDS: readonly MatrixKind[] = ["pharmaco", "ddx"];

/**
 * Columns are fixed server-side and never taken from the model: the client
 * relies on this exact order (sticky first column = the row's key), and a
 * model renaming or reordering a header would silently misalign every cell.
 */
const MATRIX_COLUMNS: Record<MatrixKind, readonly string[]> = {
  pharmaco: [
    "Molécule",
    "Classe",
    "Mécanisme d'action",
    "Indications",
    "Effets indésirables",
    "Contre-indications",
    "Posologie / remarques",
  ],
  ddx: [
    "Diagnostic",
    "Terrain / contexte",
    "Arguments cliniques",
    "Examens clés",
    "Élément discriminant",
    "Piège d'examen",
  ],
};

const DEFAULT_TITLES: Record<MatrixKind, string> = {
  pharmaco: "Matrice pharmacologique",
  ddx: "Diagnostic différentiel",
};

/** Same bound as the other single-call Studio insights: enough for a full course, small enough to stay well inside a 50s CHEAP_MODEL call. */
const MAX_SOURCE_CHARS_FOR_MATRIX = 16_000;
const MAX_ROWS = 25;
const MAX_NOTES = 5;
const MAX_CELL_CHARS = 320;
const MAX_NOTE_CHARS = 400;
const MAX_TITLE_CHARS = 120;

const COLUMN_GUIDE: Record<MatrixKind, string> = {
  pharmaco: `Tu es un pharmacologue clinicien, enseignant en faculté de médecine et de pharmacie en Algérie. À partir du cours fourni, tu construis une MATRICE PHARMACOLOGIQUE de révision : dense, exacte, directement utilisable pour préparer un examen.

Colonnes, dans CET ordre exact (une cellule par colonne) :
1. Molécule — la DCI (le nom de spécialité entre parenthèses uniquement s'il est cité dans le cours).
2. Classe — classe pharmacologique / thérapeutique.
3. Mécanisme d'action — cible et effet, en une formule précise.
4. Indications — en priorité celles citées dans le cours.
5. Effets indésirables — les plus fréquents et les plus graves (ceux qui tombent à l'examen).
6. Contre-indications — les absolues d'abord.
7. Posologie / remarques — une posologie UNIQUEMENT si elle figure dans le cours ; sinon une remarque pratique (surveillance, interaction majeure, terrain particulier).

Lignes :
- Une ligne = une molécule (ou une classe, si le cours ne raisonne que par classe) RÉELLEMENT citée dans le cours. N'ajoute jamais une molécule que le cours ne mentionne pas.
- 25 lignes au maximum ; si le cours en cite davantage, garde les plus importantes pour l'examen et signale-le dans "notes".
- Si le cours ne mentionne AUCUN médicament (anatomie, physiologie, sémiologie...), renvoie "rows": [] et explique-le honnêtement en une phrase dans "notes". Ne fabrique jamais une ligne pour remplir le tableau.`,
  ddx: `Tu es un clinicien enseignant en faculté de médecine en Algérie. À partir du cours fourni, tu construis une MATRICE DE DIAGNOSTIC DIFFÉRENTIEL de révision : dense, exacte, pensée pour les QCM et les cas cliniques d'examen.

Colonnes, dans CET ordre exact (une cellule par colonne) :
1. Diagnostic — nom précis de l'entité.
2. Terrain / contexte — âge, sexe, facteurs de risque, circonstances de survenue.
3. Arguments cliniques — signes fonctionnels et physiques évocateurs.
4. Examens clés — biologie, imagerie ou examen spécialisé, avec le résultat attendu.
5. Élément discriminant — LE signe ou le résultat qui permet de trancher face aux autres lignes du tableau.
6. Piège d'examen — la confusion ou l'erreur classique en QCM / cas clinique.

Lignes :
- Identifie le tableau clinique central du cours (pathologie ou symptôme principal). La première ligne est la pathologie principale du cours, puis viennent les diagnostics différentiels discutés dans le cours.
- Si le cours en cite peu, complète uniquement avec les diagnostics différentiels classiques et consensuels de ce tableau (connaissance médicale standard et vérifiée), sans jamais en inventer.
- Entre 4 et 12 lignes en général, 25 au maximum.
- Si le cours ne se prête à aucun diagnostic différentiel (cours purement fondamental : anatomie, biochimie, histologie...), renvoie "rows": [] et explique-le honnêtement en une phrase dans "notes". Ne fabrique jamais une ligne pour remplir le tableau.`,
};

function buildSystemPrompt(kind: MatrixKind): string {
  const columnCount = MATRIX_COLUMNS[kind].length;
  return `${COLUMN_GUIDE[kind]}

Consignes STRICTES :
1. Réponds UNIQUEMENT avec un JSON valide de la forme exacte {"title": "...", "rows": [["...", "..."]], "notes": ["..."]} — aucun texte autour, aucun markdown, aucun bloc de code.
2. Chaque élément de "rows" est un tableau d'EXACTEMENT ${columnCount} chaînes, dans l'ordre des colonnes ci-dessus.
3. Exactitude absolue : chaque information vient du cours ou, à défaut, de la connaissance médicale standard, vérifiée et consensuelle. N'invente jamais un chiffre, une dose, un seuil, une indication ou un nom. Si une information n'est ni dans le cours ni certaine, écris "Non précisé dans le cours".
4. Style télégraphique et dense : 15 mots maximum par cellule, aucun markdown ; sépare plusieurs éléments par " ; ".
5. "notes" : 0 à 4 remarques courtes et utiles pour l'examen (piège transversal, point de comparaison, limite du cours), avec la même exigence d'exactitude.
6. "title" : un titre court et précis pour cette matrice.
7. Tout en français.`;
}

interface StudioCourseRow {
  id: number;
  title: string;
  raw_text: string | null;
  explication: string | null;
}

const CellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
// Rows as positional arrays is what the prompt asks for; an object keyed by
// column name is the one deviation the model realistically makes, so it is
// accepted and re-mapped below rather than failing an otherwise good answer.
const RowSchema = z.union([z.array(CellSchema), z.record(CellSchema)]);
const MatrixAiSchema = z.object({
  title: z.string().nullish(),
  rows: z.array(RowSchema).max(80),
  notes: z.array(z.string()).nullish(),
});

type AiCell = z.infer<typeof CellSchema>;
type AiRow = z.infer<typeof RowSchema>;

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cleanText(value: unknown, maxChars: number): string {
  if (value === null || value === undefined || typeof value === "object") return "";
  const text = String(value)
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

/** Turns one validated row into exactly `columns.length` clean cells (pads short rows, trims long ones). */
function toCells(row: AiRow, columns: readonly string[]): string[] {
  let values: AiCell[];
  if (Array.isArray(row)) {
    values = row;
  } else {
    const entries = Object.entries(row);
    const byKey = new Map(entries.map(([key, value]) => [normalizeKey(key), value]));
    const matched = columns.map((column) => byKey.get(normalizeKey(column)));
    values = matched.some((value) => value !== undefined)
      ? matched.map((value) => value ?? null)
      : entries.map(([, value]) => value);
  }
  return columns.map((_, index) => cleanText(values[index], MAX_CELL_CHARS));
}

/** A cached row written by an older generator must still match the exact shape the client renders. */
function isStoredMatrix(
  value: unknown,
  kind: MatrixKind,
  columns: readonly string[]
): value is { kind: MatrixKind; title: string; columns: string[]; rows: string[][]; notes: string[] } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== kind || typeof v.title !== "string") return false;
  if (!Array.isArray(v.columns) || v.columns.length !== columns.length || v.columns.some((c, i) => c !== columns[i])) return false;
  if (!Array.isArray(v.notes) || v.notes.some((n) => typeof n !== "string")) return false;
  return (
    Array.isArray(v.rows) &&
    v.rows.every((row) => Array.isArray(row) && row.length === columns.length && row.every((cell) => typeof cell === "string"))
  );
}

function pickSourceText(course: StudioCourseRow): string {
  const explication = course.explication?.trim();
  const source = explication ? explication : (course.raw_text ?? "").trim();
  return source.slice(0, MAX_SOURCE_CHARS_FOR_MATRIX);
}

/**
 * On-demand "Matrice Pharmaco / Diagnostic différentiel" for one course.
 * Unlike clinical-connections (a few lines, rate-limit only), a matrix is a
 * full structured generation, so it reserves one unit of the plan's monthly
 * courseCap BEFORE the OpenRouter call and refunds it on any failure after
 * that point — same reserve/refund contract as the flashcards route. Nothing
 * is persisted server-side: the client caches the result per student/course.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-matrix:${user.id}`, RATE_LIMITS.ai);
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

  const { courseId, kind, language: languageRaw } = (body ?? {}) as { courseId?: unknown; kind?: unknown; language?: unknown };
  // Global AI-content language (store/useLanguageStore.ts): drives the prompt AND the cache key.
  const language = parseContentLanguage(languageRaw);
  if (typeof courseId !== "number" || !Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ success: false, error: "'courseId' est requis (entier positif)." }, { status: 400 });
  }
  if (typeof kind !== "string" || !MATRIX_KINDS.includes(kind as MatrixKind)) {
    return NextResponse.json({ success: false, error: "'kind' doit valoir \"pharmaco\" ou \"ddx\"." }, { status: 400 });
  }
  const matrixKind = kind as MatrixKind;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const { data: courseRow, error: courseError } = await getSupabaseAdmin()
    .from("studio_courses")
    .select("id, title, raw_text, explication")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (courseError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
  }
  if (!courseRow) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const course = courseRow as StudioCourseRow;
  const sourceText = pickSourceText(course);
  if (!sourceText) {
    return NextResponse.json(
      { success: false, error: "Ce cours n'a pas encore de contenu exploitable pour construire une matrice." },
      { status: 422 }
    );
  }

  const columns = MATRIX_COLUMNS[matrixKind];

  // Platform-wide cache FIRST (see lib/lab-course-cache.ts): a hit returns the
  // stored matrix for 0 tokens (our bill) — the student's unit was charged
  // above, so an exhausted plan gets the same 403 as for a fresh generation.
  const contentHash = labContentHash(course.raw_text?.trim() ? course.raw_text : sourceText);
  const toolType = labToolTypeFor(`matrix:${matrixKind}`, language);
  // BILLING RULE: every NEW request for this result consumes the student's
  // standard unit, even when it is then served from the platform-wide cache
  // (that cache only cuts OUR model bill). The one exception is a re-open of
  // a result this same student already obtained (their own Lab history) —
  // not a new request. Refunded below only if nothing could be delivered.
  const charged = !(await ownsLabResult(user.id, contentHash, toolType));
  if (charged) {
    const gate = await reserveGeneration(user);
    if (!gate.allowed) {
      return NextResponse.json({ success: false, error: gate.reason }, { status: 403 });
    }
  }
  const cached = await lookupLabCache(contentHash, toolType);
  if (isStoredMatrix(cached, matrixKind, columns)) {
    await recordLabHistory({ userId: user.id, contentHash, toolType, courseId: course.id, title: cached.title });
    return NextResponse.json({ success: true, matrix: cached, cached: true });
  }

  try {
    // Fast model first, stronger fallbacks next, all under one deadline; an
    // invalid answer is rejected by `validate` and the NEXT model is asked.
    const { value: validation } = await callOpenRouterChain(
      [
        { role: "system", content: buildSystemPrompt(matrixKind) + buildLanguageDirective(language) },
        { role: "user", content: `Cours : "${course.title}"\n\nContenu du cours :\n"""\n${sourceText}\n"""` },
      ],
      {
        label: "[studio:matrix]",
        // Concurrent identical requests (double tap, two tabs) generate once;
        // a request that didn't pay gets its course credit back.
        ledger: { namespace: "lab:matrix", peerWaitMs: 30_000, leaseMs: LAB_CHAIN_DEADLINE_MS + 10_000 },
        attempts: labAttempts(),
        deadlineMs: LAB_CHAIN_DEADLINE_MS,
        maxTokens: 4500,
        temperature: 0.2,
        bypassMock: true,
        responseFormat: { type: "json_object" },
        providerSort: "throughput",
        validate: (raw) => {
          const parsed = parseJsonResponse(raw);
          const candidate = parsed.matrix && typeof parsed.matrix === "object" && !Array.isArray(parsed.matrix) ? parsed.matrix : parsed;
          const result = MatrixAiSchema.safeParse(candidate);
          if (!result.success) {
            console.error("[studio:matrix] Validation zod échouée :", result.error.flatten());
            throw new Error("La réponse de l'IA ne respecte pas le format attendu de la matrice. Réessaie.");
          }
          return result;
        },
      }
    );

    const rows = validation.data.rows
      .map((row) => toCells(row, columns))
      // A row with no molecule/diagnostic name has no key to read it by — drop it rather than show an anonymous line.
      .filter((cells) => cells[0].length > 0)
      .slice(0, MAX_ROWS);

    const notes = (validation.data.notes ?? [])
      .map((note) => cleanText(note, MAX_NOTE_CHARS))
      .filter((note) => note.length > 0)
      .slice(0, MAX_NOTES);

    const title = cleanText(validation.data.title, MAX_TITLE_CHARS) || `${DEFAULT_TITLES[matrixKind]} — ${course.title}`;

    const matrix = { kind: matrixKind, title, columns: [...columns], rows, notes };
    // Store the validated result for every later student. Empty results
    // (rows: [] — "this course has no drugs") are cached too: that answer is
    // just as final, and regenerating it would only burn another credit.
    await storeLabCache({ contentHash, toolType, courseId: course.id, content: matrix });
    await recordLabHistory({ userId: user.id, contentHash, toolType, courseId: course.id, title: matrix.title });

    return NextResponse.json({ success: true, matrix, cached: false });
  } catch (error) {
    if (charged) await refundGeneration(user.id);
    const status = error instanceof OpenRouterError ? upstreamStatusForClient(error.status) : 502;
    console.error(`[studio:matrix] Échec (cours ${course.id}, ${matrixKind}):`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
