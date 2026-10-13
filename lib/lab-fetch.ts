/**
 * fetch() for the MedArt Lab tools (mind map, matrix, virtual patient), with
 * ONE automatic second chance for the failures a student should never see:
 *
 *  - the connection dropped (fetch rejected): common on mobile during a
 *    30-60 s generation. The server keeps going and stores the result in
 *    lab_course_cache, so the second request usually returns it instantly,
 *    for free. If the device is offline, it first waits (up to
 *    OFFLINE_WAIT_MS) for the network to come back.
 *  - a FAST 502/503 (an upstream hiccup answered within FAST_FAILURE_MS).
 *
 * Never retried: 4xx (quota, validation, rate limit — retrying repeats it)
 * and a SLOW 5xx (the server already spent its whole model fallback chain;
 * a second identical wait would only double the student's wait).
 */

const RETRY_DELAY_MS = 2_500;
const FAST_FAILURE_MS = 20_000;
const OFFLINE_WAIT_MS = 30_000;

function waitForOnline(maxMs: number): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("online", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, maxMs);
    window.addEventListener("online", done);
  });
}

export async function labFetch(input: string, init: RequestInit): Promise<Response> {
  const startedAt = Date.now();
  try {
    const res = await fetch(input, init);
    const fastTransient = (res.status === 502 || res.status === 503) && Date.now() - startedAt < FAST_FAILURE_MS;
    if (!fastTransient) return res;
  } catch (error) {
    if (init.signal?.aborted) throw error;
    await waitForOnline(OFFLINE_WAIT_MS);
  }
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return fetch(input, init);
}
