import { AiRunGovernor, classifyUpstreamStatus } from "@/lib/ai-run-governor";
import type { ExamPreferences } from "@/lib/exam-preferences";
import type { ExamStyleProfile } from "@/lib/ai/exam-schemas";

/**
 * Browser driver for the Examen de Module (app/api/exam/run): plan → many
 * small batches in parallel → assemble. Each batch is its own short request,
 * so 50 selected courses never means one request racing Vercel's limit;
 * failed or short batches are retried silently under the adaptive run
 * governor (429 → fewer in flight + pause), and a run that genuinely cannot
 * finish gives its quota back.
 */

export interface ExamRunRequest {
  moduleId: number;
  courseIds: number[];
  variation: boolean;
  preferences: ExamPreferences;
  styleProfile?: ExamStyleProfile | null;
}

export interface ExamRunProgress {
  /** Questions ready (reused + freshly generated). */
  done: number;
  total: number;
  phase: "plan" | "questions" | "assemble";
}

export interface ExamRunResponse {
  success?: boolean;
  error?: string;
  exam?: unknown;
  regenerationsRemaining?: number;
}

interface ExamJob {
  courseIds: number[];
  count: number;
  segment: [number, number] | null;
}

interface Sealed {
  questions: unknown[];
  seal: string | null;
}

interface PlanBody extends ExamRunResponse {
  fallback?: boolean;
  run?: { token: string; target: number; pooled: Sealed; jobs: ExamJob[] };
}

const MAX_JOB_ATTEMPTS = 4;
const TOP_UP_ROUNDS = 2;

async function post<T>(url: string, payload: unknown): Promise<{ status: number; retryAfter: number | null; body: T }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, retryAfter: Number(res.headers.get("Retry-After")) || null, body };
  } catch {
    return { status: 0, retryAfter: null, body: {} as T };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runExamGeneration(request: ExamRunRequest, onProgress: (p: ExamRunProgress) => void): Promise<{ ok: boolean; body: ExamRunResponse }> {
  const base = {
    moduleId: request.moduleId,
    courseIds: request.courseIds,
    variation: request.variation,
    preferences: request.preferences,
    ...(request.styleProfile ? { styleProfile: request.styleProfile } : {}),
  };
  onProgress({ done: 0, total: 0, phase: "plan" });

  const plan = await post<PlanBody>("/api/exam/run", { ...base, action: "plan" });
  if (plan.status === 501 && plan.body.fallback) {
    // Server without a signing secret: the one-shot route still works.
    const direct = await post<ExamRunResponse>("/api/exam/generate", base);
    return { ok: direct.status >= 200 && direct.status < 300 && Boolean(direct.body.success), body: direct.body };
  }
  if (plan.status < 200 || plan.status >= 300 || !plan.body.success) return { ok: false, body: plan.body };
  if (plan.body.exam) return { ok: true, body: plan.body };
  const run = plan.body.run;
  if (!run) return { ok: false, body: { error: "Réponse de planification incomplète." } };

  const withToken = { ...base, runToken: run.token };
  const batches: Sealed[] = [];
  let done = run.pooled.questions.length;
  const report = (phase: ExamRunProgress["phase"]) => onProgress({ done: Math.min(done, run.target), total: run.target, phase });
  report("questions");

  const governor = new AiRunGovernor({
    // The run token lives 30 min: leave room to assemble.
    deadlineMs: 25 * 60_000,
    stallMs: 8 * 60_000,
    maxConcurrency: 8,
    breakerThreshold: 6,
    minAttemptWindowMs: 20_000,
  });
  let fatal: string | null = null;

  async function runJobs(jobs: ExamJob[]): Promise<void> {
    const queue = jobs.map((job) => ({ job, attempt: 1 }));
    let active = 0;
    async function worker(): Promise<void> {
      for (;;) {
        if (fatal) return;
        const next = queue.shift();
        if (!next) {
          if (active === 0) return;
          await sleep(250);
          continue;
        }
        active++;
        try {
          if (!(await governor.acquire())) {
            queue.length = 0;
            return;
          }
          let response: Awaited<ReturnType<typeof post<{ success?: boolean; error?: string; questions?: unknown[]; seal?: string | null }>>>;
          try {
            response = await post("/api/exam/run", { ...withToken, action: "batch", job: next.job });
          } finally {
            governor.release();
          }
          const { status, retryAfter, body } = response;
          if (status >= 200 && status < 300 && body.success && Array.isArray(body.questions)) {
            governor.reportSuccess();
            batches.push({ questions: body.questions, seal: body.seal ?? null });
            done += body.questions.length;
            report("questions");
            const missing = next.job.count - body.questions.length;
            if (missing > 0 && next.attempt < MAX_JOB_ATTEMPTS) queue.push({ job: { ...next.job, count: missing }, attempt: next.attempt + 1 });
            continue;
          }
          // Session expired / forbidden / invalid: retrying cannot help.
          if (status === 400 || status === 401 || status === 403) {
            fatal = body.error ?? "Génération interrompue.";
            return;
          }
          const kind = classifyUpstreamStatus(status) ?? "server";
          governor.reportUpstreamFailure(kind, retryAfter);
          if (next.attempt < MAX_JOB_ATTEMPTS) {
            if (kind !== "overload") await sleep(1_500 * next.attempt);
            queue.push({ job: next.job, attempt: next.attempt + 1 });
          }
        } finally {
          active--;
        }
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  async function refund(): Promise<ExamRunResponse> {
    const res = await post<ExamRunResponse>("/api/exam/run", { ...withToken, action: "refund" });
    return res.body;
  }

  await runJobs(run.jobs);
  for (let round = 0; round <= TOP_UP_ROUNDS && !fatal; round++) {
    report("assemble");
    const assembled = await post<ExamRunResponse & { count?: number }>("/api/exam/run", { ...withToken, action: "assemble", pooled: run.pooled, batches });
    if (assembled.status >= 200 && assembled.status < 300 && assembled.body.success) return { ok: true, body: assembled.body };
    if (assembled.status !== 422 || governor.stopped || round === TOP_UP_ROUNDS) {
      fatal = assembled.body.error ?? "L'examen n'a pas pu être assemblé.";
      break;
    }
    // Not enough valid questions yet: top up over the same course groups.
    let deficit = Math.max(1, run.target - (assembled.body.count ?? done));
    const topUp: ExamJob[] = [];
    for (let i = 0; deficit > 0 && run.jobs.length > 0; i++) {
      const source = run.jobs[i % run.jobs.length];
      const count = Math.min(5, deficit);
      topUp.push({ ...source, count });
      deficit -= count;
    }
    report("questions");
    await runJobs(topUp);
  }

  const stop = governor.stopped;
  const refunded = await refund();
  const reason =
    stop === "overload"
      ? "MedArt Neural Engine est très sollicité en ce moment."
      : stop === "deadline" || stop === "stalled"
        ? "La génération a pris trop de temps."
        : (fatal ?? "La génération n'a pas abouti.");
  return {
    ok: false,
    body: {
      error: `${reason} Ta génération a été recréditée — réessaie dans quelques minutes.`,
      ...(typeof refunded.regenerationsRemaining === "number" ? { regenerationsRemaining: refunded.regenerationsRemaining } : {}),
    },
  };
}
