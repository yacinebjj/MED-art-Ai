import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { buildExamStaticSystemPrompt, buildExamStyleAdaptedSystemPrompt, type ExamCourseInput } from "@/lib/ai/exam-prompts";
import { ExamGenerationSchema, ExamQuestionSchema, ExamStyleProfileSchema, type ExamStyleProfile } from "@/lib/ai/exam-schemas";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { ExamPreferencesSchema, buildExamPreferenceDirective, isDefaultExamPreferences, type ExamPreferences } from "@/lib/exam-preferences";
import { computeExamContentHash, lookupExamCache, recordExamCacheHit, storeExamCache } from "@/lib/exam-content-cache";
import { lookupExamVariations, insertExamVariation, recordExamVariationHit } from "@/lib/exam-content-variations";
import { poolExamQuestions, convertExamQuestionToHarvestableQcm, type ExamQuestion } from "@/lib/exam-pooling";
import { lookupHarvestedQcms, storeHarvestedQcm } from "@/lib/exam-harvested-qcms";
import { createSynthesisRunToken, sealRunPayload, verifyRunPayload, verifySynthesisRunToken } from "@/lib/synthesis-run-token";
import {
  EXAM_TARGET_TOTAL,
  MAX_EXAM_VARIATIONS,
  MODULE_EXAM_REGENERATE_CAP,
  friendlyOpenRouterErrorMessage,
  generateExamJob,
  isMissingRpcError,
  refundRegenerationFallback,
  reserveRegenerationFallback,
  type EligibleCourseRow,
  type SupabaseAdmin,
} from "@/lib/exam-generation";

/**
 * CLIENT-ORCHESTRATED EXAM RUN (2026-10-04) — replaces the single long
 * request for the Examen de Module.
 *
 * Real failure: with 10-50 selected courses the one-shot route had to run
 * every shortfall generation inside ONE function invocation; on a slow
 * provider a batch hit its per-call timeout and the student got "MedArt
 * Neural Engine met trop de temps à répondre" with nothing to show for the
 * minutes spent. Now:
 *
 *  - plan: same validation, quota/regeneration reservation, cache and
 *    variation-pool lookups and pooling as before; returns the pooled
 *    questions (sealed) and a list of small JOBS (≤5 questions each over
 *    ≤5 courses, or one slice of a long course) — or the finished exam
 *    directly on a cache hit.
 *  - batch: ONE job per request, a whole function invocation each (same
 *    model, prompts, schema and validation as before). The browser runs many
 *    in parallel under the adaptive run governor and silently retries a
 *    failed or short job, so no single slow call can sink the exam.
 *  - assemble: verifies every sealed payload (nothing the client invents is
 *    accepted), validates, saves exactly like the one-shot route.
 *  - refund: a run abandoned by the client gives its quota back (once).
 *
 * Every step is bound to the run token (user, module and a digest of the
 * request parameters), so batch calls cannot be made outside a reserved run.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const JOB_QUESTIONS = 5;
const JOB_MAX_COURSES = 5;
const JOB_MAX_SEGMENTS = 12;
const MIN_SEGMENT_CHARS = 2_500;
/** Source text per job: ~7k tokens, measured enough for 5 precise QCMs (more only cost time and money). */
const JOB_INPUT_CHARS = 24_000;
const MAX_FINAL_QUESTIONS = 60;
/** Batch calls one run may make (jobs + silent retries), per server instance. */
const RUN_BATCH_LIMIT = { limit: 120, windowMs: 30 * 60_000 };

interface ExamJob {
  courseIds: number[];
  count: number;
  /** [index, of]: the job covers that slice of its single course's text. */
  segment: [number, number] | null;
}

interface RunParams {
  moduleId: number;
  courseIds: number[];
  isVariation: boolean;
  styleProfile?: ExamStyleProfile;
  customPreferences?: ExamPreferences;
  isPersonalized: boolean;
  tokenType: string;
}

type ParsedParams = { ok: true; params: RunParams } | { ok: false; response: NextResponse };

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

function parseParams(body: Record<string, unknown>): ParsedParams {
  const { moduleId, courseIds, variation, styleProfile: rawStyle, preferences: rawPreferences } = body;
  if (typeof moduleId !== "number" || !Number.isFinite(moduleId)) return { ok: false, response: bad("'moduleId' est requis et doit être un nombre.") };
  if (!Array.isArray(courseIds) || courseIds.length === 0 || courseIds.length > 200 || !courseIds.every((id) => typeof id === "number" && Number.isFinite(id))) {
    return { ok: false, response: bad("'courseIds' est requis (tableau d'identifiants non vide).") };
  }
  let styleProfile: ExamStyleProfile | undefined;
  if (rawStyle !== undefined && rawStyle !== null) {
    const parsed = ExamStyleProfileSchema.safeParse(rawStyle);
    if (!parsed.success) return { ok: false, response: bad("'styleProfile' est invalide.") };
    styleProfile = parsed.data;
  }
  let customPreferences: ExamPreferences | undefined;
  if (rawPreferences !== undefined && rawPreferences !== null) {
    const parsed = ExamPreferencesSchema.safeParse(rawPreferences);
    if (!parsed.success) return { ok: false, response: bad("'preferences' est invalide.") };
    if (!isDefaultExamPreferences(parsed.data)) customPreferences = parsed.data;
  }
  const ids = Array.from(new Set(courseIds as number[])).sort((a, b) => a - b);
  const isVariation = variation === true;
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ ids, isVariation, styleProfile: styleProfile ?? null, preferences: customPreferences ?? null }))
    .digest("base64url")
    .slice(0, 22);
  return {
    ok: true,
    params: { moduleId, courseIds: ids, isVariation, styleProfile, customPreferences, isPersonalized: Boolean(styleProfile || customPreferences), tokenType: `exam:${digest}` },
  };
}

async function loadCourses(supabase: SupabaseAdmin, userId: string, moduleId: number, ids: number[], withQcms: boolean): Promise<EligibleCourseRow[]> {
  const { data, error } = await supabase
    .from("studio_courses")
    .select(withQcms ? "id, title, explication, raw_text, qcms" : "id, title, explication, raw_text")
    .eq("user_id", userId)
    .eq("curriculum_module_id", moduleId)
    .in("id", ids)
    .order("id", { ascending: true });
  if (error) throw new Error(`Lecture échouée : ${error.message}`);
  return ((data ?? []) as unknown as EligibleCourseRow[]).map((c) => ({ ...c, qcms: withQcms ? c.qcms : null }));
}

/** Final exam size: 40, or one question per course past 40 courses (max 60). */
function finalTarget(courseCount: number): number {
  return Math.min(MAX_FINAL_QUESTIONS, Math.max(EXAM_TARGET_TOTAL, courseCount));
}

/** Small courses are packed together (≤5 questions, ≤5 courses per job); a course needing more is split into slices of its own text. */
function planJobs(needs: { id: number; count: number }[]): ExamJob[] {
  const jobs: ExamJob[] = [];
  let pack: ExamJob | null = null;
  for (const need of needs) {
    if (need.count <= 0) continue;
    if (need.count > JOB_QUESTIONS) {
      const slices = Math.min(JOB_MAX_SEGMENTS, Math.ceil(need.count / JOB_QUESTIONS));
      for (let i = 0; i < slices; i++) {
        const count = Math.floor(need.count / slices) + (i < need.count % slices ? 1 : 0);
        jobs.push({ courseIds: [need.id], count, segment: slices > 1 ? [i, slices] : null });
      }
      continue;
    }
    if (!pack || pack.count + need.count > JOB_QUESTIONS || pack.courseIds.length >= JOB_MAX_COURSES) {
      pack = { courseIds: [], count: 0, segment: null };
      jobs.push(pack);
    }
    pack.courseIds.push(need.id);
    pack.count += need.count;
  }
  return jobs;
}

/** Spreads `total` questions over courses, capped per course by `caps` (round-robin, in course order). */
function distribute(courseIds: number[], total: number, caps: Map<number, number>): { id: number; count: number }[] {
  const counts = new Map(courseIds.map((id) => [id, 0]));
  let left = total;
  while (left > 0) {
    let progressed = false;
    for (const id of courseIds) {
      if (left === 0) break;
      if (counts.get(id)! < (caps.get(id) ?? Infinity)) {
        counts.set(id, counts.get(id)! + 1);
        left--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return courseIds.map((id) => ({ id, count: counts.get(id)! }));
}

function jobInputs(courses: EligibleCourseRow[], segment: [number, number] | null): ExamCourseInput[] {
  const cap = Math.max(500, Math.floor(JOB_INPUT_CHARS / Math.max(1, courses.length)));
  return courses.map((course) => {
    let text = course.explication ?? course.raw_text;
    let title = course.title;
    if (segment) {
      // A slice is never shorter than MIN_SEGMENT_CHARS: a short course is
      // cut into fewer slices, and jobs sharing a slice are told to vary.
      const [index, of] = segment;
      const slices = Math.max(1, Math.min(of, Math.floor(text.length / MIN_SEGMENT_CHARS)));
      const slice = index % slices;
      const size = Math.ceil(text.length / slices);
      if (slices > 1) text = text.slice(slice * size, (slice + 1) * size);
      title = slices > 1 ? `${course.title} (partie ${slice + 1}/${slices})` : course.title;
      if (of > slices) title += ` — série ${index + 1}/${of} : choisis des notions différentes des autres séries`;
    }
    return { title, text: text.slice(0, cap) };
  });
}

function questionKey(q: ExamQuestion): string {
  return q.vignette.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Per-instance run state: a run is assembled OR refunded, never both. */
const runOutcomes = new Map<string, { state: "assembled" | "refunded"; at: number }>();
function markRun(token: string, state: "assembled" | "refunded"): boolean {
  const now = Date.now();
  for (const [key, value] of Array.from(runOutcomes)) if (now - value.at > 40 * 60_000) runOutcomes.delete(key);
  if (runOutcomes.has(token)) return false;
  runOutcomes.set(token, { state, at: now });
  return true;
}

async function refundRegeneration(supabase: SupabaseAdmin, userId: string): Promise<void> {
  const { error } = await supabase.rpc("refund_module_exam_regenerate", { p_user_id: userId });
  if (isMissingRpcError(error)) await refundRegenerationFallback(supabase, userId);
  else if (error) console.warn("[exam/run] Échec refund_module_exam_regenerate:", error.message);
}

async function regenerationsRemainingFor(supabase: SupabaseAdmin, userId: string): Promise<number | undefined> {
  const { data, error } = await supabase.from("profiles").select("module_exam_regenerations_used").eq("id", userId).maybeSingle();
  if (error) return undefined;
  const used = Number((data as { module_exam_regenerations_used?: number | null } | null)?.module_exam_regenerations_used ?? 0);
  return Math.max(0, MODULE_EXAM_REGENERATE_CAP - used);
}

/** Saves a finished exam exactly like the one-shot route (shared cache, variation pool, history row). */
async function saveExam(
  supabase: SupabaseAdmin,
  userId: string,
  params: RunParams,
  courses: EligibleCourseRow[],
  content: unknown,
  source: { cached: boolean; fromVariationPool: boolean; contentHash: string; variationIndex: number }
): Promise<NextResponse> {
  const selectedCourses = courses.map((course) => ({ id: course.id, title: course.title }));
  if (!source.cached && !params.isVariation && !params.isPersonalized) void storeExamCache(source.contentHash, content, selectedCourses);
  if (params.isVariation && !source.fromVariationPool && !params.isPersonalized) {
    const insert = await insertExamVariation(source.contentHash, source.variationIndex, content);
    if (insert.conflict) console.warn("[exam/run] Conflit d'insertion de variation — contenu servi quand même.");
  }
  const { data: inserted, error } = await supabase
    .from("module_generated_exams")
    .insert({ user_id: userId, curriculum_module_id: params.moduleId, selected_courses: selectedCourses, content })
    .select("id, selected_courses, content, created_at")
    .single();
  if (error || !inserted) {
    console.error("[exam/run] Échec sauvegarde:", error);
    return NextResponse.json({ success: false, error: "L'examen a été généré mais n'a pas pu être sauvegardé. Réessaie." }, { status: 500 });
  }
  const regenerationsRemaining = params.isVariation ? await regenerationsRemainingFor(supabase, userId) : undefined;
  return NextResponse.json({
    success: true,
    exam: { id: inserted.id, selectedCourses: inserted.selected_courses, content: inserted.content, createdAt: inserted.created_at },
    ...(regenerationsRemaining !== undefined ? { regenerationsRemaining } : {}),
  });
}

function toExamContent(questions: ExamQuestion[]): unknown {
  return sanitizeForPostgres({ questions: questions.map((question, index) => ({ id: `q${index + 1}`, ...question })) });
}

// ─── plan ────────────────────────────────────────────────────────────────

async function handlePlan(userId: string, user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>, params: RunParams): Promise<NextResponse> {
  const rl = rateLimit(`exam-generate:${userId}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: "Trop de requêtes — réessaie dans quelques minutes." }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } });
  }
  const runToken = createSynthesisRunToken(userId, params.moduleId, params.tokenType);
  // No signing secret configured: the client falls back to the one-shot route.
  if (!runToken) return NextResponse.json({ success: false, fallback: true, error: "Mode par lots indisponible." }, { status: 501 });

  const supabase = getSupabaseAdmin();
  if (params.isVariation) {
    const rpc = await supabase.rpc("reserve_module_exam_regenerate", { p_user_id: userId, p_cap: MODULE_EXAM_REGENERATE_CAP });
    let count = rpc.data as number | null;
    let rpcError = rpc.error;
    if (isMissingRpcError(rpcError)) {
      const fallback = await reserveRegenerationFallback(supabase, userId, MODULE_EXAM_REGENERATE_CAP);
      if (fallback === "unavailable") {
        return bad("La régénération est momentanément indisponible (mise à jour du serveur en cours). Ton examen actuel est conservé : réessaie dans quelques minutes.", 503);
      }
      count = fallback;
      rpcError = null;
    }
    if (rpcError) return bad("Impossible de vérifier ton quota de régénérations pour le moment. Réessaie dans quelques minutes.", 500);
    if (count === null) {
      return NextResponse.json(
        { success: false, error: `Tu as atteint la limite de ${MODULE_EXAM_REGENERATE_CAP} régénérations pour l'Examen de Module.`, regenerationsRemaining: 0 },
        { status: 403 }
      );
    }
  }
  const undoRegeneration = async () => {
    if (params.isVariation) await refundRegeneration(supabase, userId);
  };

  let courses: EligibleCourseRow[];
  try {
    courses = await loadCourses(supabase, userId, params.moduleId, params.courseIds, true);
  } catch (error) {
    await undoRegeneration();
    return bad(errorMessage(error), 500);
  }
  if (courses.length === 0) {
    await undoRegeneration();
    return bad("Aucun cours sélectionné trouvé dans ce module.");
  }

  // Shared cache / variation pool — identical rules to the one-shot route.
  const contentHash = computeExamContentHash(courses);
  let existingVariationCount = 0;
  if (!params.isPersonalized) {
    if (!params.isVariation) {
      const cached = await lookupExamCache(contentHash);
      if (cached) {
        void recordExamCacheHit(contentHash);
        return saveExam(supabase, userId, params, courses, cached, { cached: true, fromVariationPool: false, contentHash, variationIndex: 0 });
      }
    } else {
      const { existing } = await lookupExamVariations(contentHash);
      existingVariationCount = existing.length;
      if (existing.length >= MAX_EXAM_VARIATIONS) {
        const picked = existing[Math.floor(Math.random() * existing.length)];
        void recordExamVariationHit(picked.id);
        return saveExam(supabase, userId, params, courses, picked.content, { cached: false, fromVariationPool: true, contentHash, variationIndex: 0 });
      }
    }
  }

  const quota = await reserveGeneration(user);
  if (!quota.allowed) {
    await undoRegeneration();
    return bad(quota.reason ?? "Quota de générations atteint.", 403);
  }

  try {
    const target = finalTarget(courses.length);
    const ids = courses.map((c) => c.id);
    let pooled: ExamQuestion[] = [];
    let needs: { id: number; count: number }[];
    if (params.isPersonalized) {
      needs = distribute(ids, target, new Map());
    } else {
      const harvested = await lookupHarvestedQcms(ids);
      const targetPerCourse = Math.max(1, Math.ceil(EXAM_TARGET_TOTAL / courses.length));
      const pooling = poolExamQuestions(
        courses.map((c) => ({ id: c.id, title: c.title, qcms: c.qcms, harvestedQcms: harvested.get(c.id) })),
        targetPerCourse
      );
      pooled = pooling.pooled.slice(0, MAX_FINAL_QUESTIONS);
      const caps = new Map(pooling.shortfallByCourse.map((s) => [s.id, s.shortfall]));
      needs = distribute(
        pooling.shortfallByCourse.map((s) => s.id),
        Math.max(0, target - pooled.length),
        caps
      );
    }
    const jobs = planJobs(needs);

    if (jobs.length === 0) {
      // Fully covered by already-generated questions: finished right here.
      const result = ExamGenerationSchema.safeParse({ questions: pooled });
      if (result.success) {
        markRun(runToken, "assembled");
        return saveExam(supabase, userId, params, courses, toExamContent(result.data.questions), {
          cached: false,
          fromVariationPool: false,
          contentHash,
          variationIndex: existingVariationCount + 1,
        });
      }
    }

    return NextResponse.json({
      success: true,
      run: {
        token: runToken,
        target,
        pooled: { questions: pooled, seal: sealRunPayload(runToken, JSON.stringify(pooled)) },
        jobs,
      },
    });
  } catch (error) {
    await refundGeneration(userId);
    await undoRegeneration();
    console.error("[exam/run] Échec du plan:", error);
    return bad(errorMessage(error), 500);
  }
}

// ─── batch ───────────────────────────────────────────────────────────────

function parseJob(raw: unknown, allowed: Set<number>): ExamJob | null {
  if (!raw || typeof raw !== "object") return null;
  const { courseIds, count, segment } = raw as Record<string, unknown>;
  if (!Array.isArray(courseIds) || courseIds.length === 0 || courseIds.length > JOB_MAX_COURSES) return null;
  if (!courseIds.every((id) => typeof id === "number" && allowed.has(id))) return null;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 8) return null;
  let seg: [number, number] | null = null;
  if (segment !== null && segment !== undefined) {
    if (!Array.isArray(segment) || segment.length !== 2 || courseIds.length !== 1) return null;
    const [index, of] = segment as unknown[];
    if (typeof index !== "number" || typeof of !== "number" || !Number.isInteger(index) || !Number.isInteger(of) || of < 2 || of > JOB_MAX_SEGMENTS || index < 0 || index >= of) return null;
    seg = [index, of];
  }
  return { courseIds: courseIds as number[], count, segment: seg };
}

async function handleBatch(userId: string, params: RunParams, runToken: string, rawJob: unknown): Promise<NextResponse> {
  const job = parseJob(rawJob, new Set(params.courseIds));
  if (!job) return bad("Lot invalide.");
  const rl = rateLimit(`exam-run:${runToken}`, RUN_BATCH_LIMIT);
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Trop de lots pour cette génération." }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } });

  const supabase = getSupabaseAdmin();
  let courses: EligibleCourseRow[];
  try {
    courses = await loadCourses(supabase, userId, params.moduleId, job.courseIds, false);
  } catch (error) {
    return bad(errorMessage(error), 500);
  }
  if (courses.length === 0) return bad("Cours introuvables pour ce lot.", 404);

  const inputs = jobInputs(courses, job.segment);
  let systemPrompt: string | undefined;
  if (params.isPersonalized) {
    const base = params.styleProfile ? buildExamStyleAdaptedSystemPrompt(inputs, params.styleProfile) : buildExamStaticSystemPrompt(inputs);
    const directive = params.customPreferences ? buildExamPreferenceDirective(params.customPreferences) : "";
    systemPrompt = directive ? `${base}\n\n${directive}` : base;
  }

  try {
    const questions = await generateExamJob(inputs, job.count, params.isVariation, systemPrompt);
    // Single-course, canonical questions feed that course's reusable pool.
    if (!params.isPersonalized && courses.length === 1) {
      for (const question of questions) void storeHarvestedQcm(courses[0].id, sanitizeForPostgres(convertExamQuestionToHarvestableQcm(question, 0)));
    }
    return NextResponse.json({ success: true, questions, seal: sealRunPayload(runToken, JSON.stringify(questions)) });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: friendlyOpenRouterErrorMessage(error) }, { status: error.status >= 400 && error.status < 600 ? error.status : 502 });
    }
    console.warn("[exam/run] Lot en échec:", errorMessage(error));
    return bad(errorMessage(error), 502);
  }
}

// ─── assemble ────────────────────────────────────────────────────────────

interface SealedQuestions {
  questions: unknown;
  seal: unknown;
}

function openSealed(runToken: string, sealed: unknown): ExamQuestion[] | null {
  if (!sealed || typeof sealed !== "object") return null;
  const { questions, seal } = sealed as SealedQuestions;
  if (!Array.isArray(questions) || !verifyRunPayload(runToken, JSON.stringify(questions), seal)) return null;
  const valid: ExamQuestion[] = [];
  for (const q of questions) {
    const parsed = ExamQuestionSchema.safeParse(q);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
}

async function handleAssemble(userId: string, params: RunParams, runToken: string, body: Record<string, unknown>): Promise<NextResponse> {
  const pooled = openSealed(runToken, body.pooled);
  const batches = Array.isArray(body.batches) ? body.batches.slice(0, 200) : null;
  if (!pooled || !batches) return bad("Résultats de génération invalides.", 400);
  const generated: ExamQuestion[] = [];
  for (const batch of batches) {
    const opened = openSealed(runToken, batch);
    if (!opened) return bad("Résultats de génération invalides.", 400);
    generated.push(...opened);
  }

  const seen = new Set<string>();
  const merged = [...pooled, ...generated].filter((q) => {
    const key = questionKey(q);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const result = ExamGenerationSchema.safeParse({ questions: merged.slice(0, MAX_FINAL_QUESTIONS) });
  if (!result.success) {
    return NextResponse.json({ success: false, error: "Pas encore assez de questions valides.", count: merged.length }, { status: 422 });
  }

  const supabase = getSupabaseAdmin();
  let courses: EligibleCourseRow[];
  try {
    courses = await loadCourses(supabase, userId, params.moduleId, params.courseIds, false);
  } catch (error) {
    return bad(errorMessage(error), 500);
  }
  if (!markRun(runToken, "assembled")) return bad("Cette génération est déjà terminée.", 409);

  const contentHash = computeExamContentHash(courses);
  const variationIndex = params.isVariation && !params.isPersonalized ? (await lookupExamVariations(contentHash)).existing.length + 1 : 0;
  const saved = await saveExam(supabase, userId, params, courses, toExamContent(result.data.questions), { cached: false, fromVariationPool: false, contentHash, variationIndex });
  // Not saved: the run stays open so the client can still refund it.
  if (saved.status >= 500) runOutcomes.delete(runToken);
  return saved;
}

// ─── refund ──────────────────────────────────────────────────────────────

async function handleRefund(userId: string, params: RunParams, runToken: string): Promise<NextResponse> {
  if (!markRun(runToken, "refunded")) return NextResponse.json({ success: true, refunded: false });
  await refundGeneration(userId);
  if (params.isVariation) await refundRegeneration(getSupabaseAdmin(), userId);
  const regenerationsRemaining = params.isVariation ? await regenerationsRemainingFor(getSupabaseAdmin(), userId) : undefined;
  return NextResponse.json({ success: true, refunded: true, ...(regenerationsRemaining !== undefined ? { regenerationsRemaining } : {}) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return bad("Tu dois être connecté(e).", 401);
    if (!isSupabaseConfigured()) return bad("Supabase n'est pas configuré sur le serveur.", 500);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch (error) {
      return bad(`Corps de requête JSON invalide : ${errorMessage(error)}`);
    }
    const parsedParams = parseParams(body);
    if (!parsedParams.ok) return parsedParams.response;
    const params = parsedParams.params;

    if (body.action === "plan") return await handlePlan(user.id, user, params);

    const runToken = body.runToken;
    if (typeof runToken !== "string" || !verifySynthesisRunToken(runToken, user.id, params.moduleId, params.tokenType)) {
      return bad("Session de génération expirée — relance la génération.", 403);
    }
    if (body.action === "batch") return await handleBatch(user.id, params, runToken, body.job);
    if (body.action === "assemble") return await handleAssemble(user.id, params, runToken, body);
    if (body.action === "refund") return await handleRefund(user.id, params, runToken);
    return bad("Action inconnue.");
  } catch (error) {
    console.error("[exam/run] Exception non interceptée:", error);
    return bad("Une erreur inattendue est survenue. Réessaie.", 500);
  }
}
