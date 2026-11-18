import { callOpenRouterChain } from "@/lib/ai/call-resilient";
import { FLASHCARD_MODEL, STUDIO_MODEL } from "@/lib/ai/openrouter";
import { STUDIO_BYPASS_MOCK, STUDIO_PROMPT_CONFIG, buildStudioSystemMessage } from "@/lib/ai/studio-prompts";
import { MIN_CHARS_FOR_ZONES, WHOLE_COURSE_BLOCK, accentLine, splitIntoFocusZones, zoneBlock } from "@/lib/ai/studio-qcm-focus";
import { STUDIO_QCM_TOTAL, StudioGeneratedQcmSchema, StudioQcmsSchema, type StudioGeneratedQcm } from "@/lib/ai/studio-schemas";
import { parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";

/**
 * Studio "Examen QCM" — 30 questions built as PARALLEL batches instead of one
 * long call.
 *
 * Why: the old single Qwen3-235B call (~40-70 tok/s) had to write every
 * question plus five explanations each before the route's 250 s budget ran
 * out. At 15 questions it already timed out routinely (and its corrective
 * retries could never fit); 30 in one call cannot fit at all. Six batches of
 * five run side by side, each ~3k output tokens, so the whole set lands in
 * roughly the time of ONE batch.
 *
 * Coverage: each batch is anchored on its own contiguous slice of the course
 * (a "focus zone") and given a different accent, so the 30 questions spread
 * over the whole course instead of clustering on its first pages, and two
 * batches don't independently pick the same notions.
 *
 * Resilience: every batch is its own model chain (STUDIO_MODEL, then the much
 * faster FLASHCARD_MODEL) under the shared deadline, and its own generation
 * ledger entry — when one batch fails and the student clicks again, the
 * batches that already succeeded are replayed for free instead of regenerated.
 */

const QCM_BATCH_COUNT = 6;
const QCMS_PER_BATCH = STUDIO_QCM_TOTAL / QCM_BATCH_COUNT;

// Zones, accents and their wording live in lib/ai/studio-qcm-focus.ts: the
// Module exam aims each of its jobs with the very same words.
export { splitIntoFocusZones } from "@/lib/ai/studio-qcm-focus";

export interface StudioQcmSet {
  titre_section: string;
  qcms: StudioGeneratedQcm[];
  qrocs: never[];
}

function buildBatchInstruction(batchIndex: number, zone: string | null): string {
  const header = `LOT ${batchIndex + 1} sur ${QCM_BATCH_COUNT} — génère EXACTEMENT ${QCMS_PER_BATCH} QCM (ids 1 à ${QCMS_PER_BATCH}), ni plus ni moins.`;
  return `${header}

${zone ? zoneBlock(zone, QCMS_PER_BATCH) : WHOLE_COURSE_BLOCK}

${accentLine(batchIndex)}`;
}

/** Accepts both the batch shape {"qcms": [...]} and the legacy nested {"qcms": {"qcms": [...]}}. */
function extractQcmArray(parsed: Record<string, unknown>): unknown[] {
  const top = parsed.qcms;
  if (Array.isArray(top)) return top;
  const nested = top && typeof top === "object" ? (top as { qcms?: unknown }).qcms : undefined;
  return Array.isArray(nested) ? nested : [];
}

/** Trims/upper-cases option labels and answer letters — " b" vs "B" is a formatting slip, not a reason to throw a good question away. */
function normalizeQcm(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const qcm = raw as { options?: unknown; reponsesCorrectes?: unknown };
  const label = (value: unknown) => (typeof value === "string" ? value.trim().toUpperCase() : value);
  return {
    ...qcm,
    options: Array.isArray(qcm.options) ? qcm.options.map((o) => (o && typeof o === "object" ? { ...o, label: label((o as { label?: unknown }).label) } : o)) : qcm.options,
    reponsesCorrectes: Array.isArray(qcm.reponsesCorrectes) ? qcm.reponsesCorrectes.map(label) : qcm.reponsesCorrectes,
  };
}

function validateBatch(raw: string): StudioGeneratedQcm[] {
  const items = extractQcmArray(parseJsonResponse(raw)).map((item) => sanitizeForPostgres(normalizeQcm(item)));
  const valid: StudioGeneratedQcm[] = [];
  for (const item of items) {
    const result = StudioGeneratedQcmSchema.safeParse(item);
    if (result.success) valid.push(result.data);
  }
  if (valid.length < QCMS_PER_BATCH) {
    throw new Error(`Lot QCM incomplet : ${valid.length}/${QCMS_PER_BATCH} questions valides (sur ${items.length} reçues).`);
  }
  return valid.slice(0, QCMS_PER_BATCH);
}

/**
 * Generates the full validated 30-question set. `languageInstruction` is the
 * route's own non-default-language suffix ("" for French). Throws when any
 * batch could not be produced in time — the caller refunds and the student
 * retries (succeeded batches are replayed from the ledger).
 */
export async function generateStudioQcmSet(
  courseText: string,
  options: { language: "fr" | "en"; languageInstruction: string; deadlineMs: number }
): Promise<StudioQcmSet> {
  const systemContent = buildStudioSystemMessage("qcm", courseText, `${STUDIO_PROMPT_CONFIG.qcm.systemPrompt}${options.languageInstruction}`);
  const zones = courseText.trim().length >= MIN_CHARS_FOR_ZONES ? splitIntoFocusZones(courseText, QCM_BATCH_COUNT) : null;

  const results = await Promise.allSettled(
    Array.from({ length: QCM_BATCH_COUNT }, (_, batchIndex) =>
      callOpenRouterChain(
        [
          { role: "system", content: systemContent },
          { role: "user", content: buildBatchInstruction(batchIndex, zones?.[batchIndex] || null) },
        ],
        {
          attempts: [
            { model: STUDIO_MODEL, timeoutMs: 140_000 },
            { model: FLASHCARD_MODEL, timeoutMs: 60_000 },
            { model: FLASHCARD_MODEL, timeoutMs: 45_000 },
          ],
          maxTokens: STUDIO_PROMPT_CONFIG.qcm.maxTokens,
          deadlineMs: options.deadlineMs,
          bypassMock: STUDIO_BYPASS_MOCK,
          providerSort: "throughput",
          validate: validateBatch,
          label: `[studio:qcm lot ${batchIndex + 1}/${QCM_BATCH_COUNT}]`,
          ledger: {
            namespace: "studio-qcm-batch",
            peerWaitMs: 90_000,
            leaseMs: 4 * 60_000,
            isValid: (value) => Array.isArray(value) && value.length === QCMS_PER_BATCH,
          },
        }
      )
    )
  );

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    for (const failure of failures) console.error("[studio:qcm] Lot en échec :", failure.reason);
    throw new Error(
      `${failures.length} lot(s) de QCM sur ${QCM_BATCH_COUNT} n'ont pas pu être générés à temps. Réessaie — ta génération n'a pas été décomptée et les lots déjà prêts seront réutilisés.`
    );
  }

  const qcms = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value.value : []))
    .map((qcm, i) => ({ ...qcm, id: i + 1 }));
  const set: StudioQcmSet = { titre_section: options.language === "en" ? "The Ultimate Test" : "L'Épreuve Ultime", qcms, qrocs: [] };
  StudioQcmsSchema.parse(set);
  return set;
}
