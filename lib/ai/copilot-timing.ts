import { describeAttempts, type RaceAttempt } from "@/lib/ai/first-token-race";

/**
 * Where a Copilot reply's time goes, measured on every request (2026-11-21).
 *
 * "Measure before you recalibrate" (docs/README.md): the Copilots' latency
 * had never been measured in production, so the slowness students reported
 * could not be located from the logs. Each reply now leaves:
 *  - one `[copilot:timing]` log line (Vercel → Logs): ms since the request
 *    arrived at each step, the model that answered and every attempt of the
 *    hedged race (lib/ai/first-token-race.ts);
 *  - a `Server-Timing` response header with the same steps, readable in the
 *    browser's DevTools (Network → Timing). It names no model or provider:
 *    students only ever see "MedArt" (brandedUpstreamMessage).
 */
export interface CopilotTimer {
  /** Records `name` at the current time (ms since the request arrived). */
  mark(name: string): void;
  /** `Server-Timing` header value: each mark as a duration since the request arrived. */
  serverTiming(): string;
  /** Writes the one-line summary. */
  log(outcome: string, attempts?: RaceAttempt[]): void;
}

export function createCopilotTimer(route: string): CopilotTimer {
  const t0 = Date.now();
  const marks: [string, number][] = [];
  return {
    mark(name) {
      marks.push([name, Date.now() - t0]);
    },
    serverTiming() {
      return marks.map(([name, ms]) => `${name.replace(/[^a-z0-9_-]/gi, "_")};dur=${ms}`).join(", ");
    },
    log(outcome, attempts) {
      const steps = marks.map(([name, ms]) => `${name}=${ms}ms`).join(" ");
      const race = attempts ? ` race=[${describeAttempts(attempts)}]` : "";
      console.log(`[copilot:timing] route=${route} outcome=${outcome} ${steps}${race}`);
    },
  };
}
