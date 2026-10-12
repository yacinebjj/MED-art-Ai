import type { JsonSectionId } from "@/lib/demo-content";

const POLL_INTERVAL_MS = 4_000;

/**
 * Recovers a Studio section whose generation request lost its connection
 * AFTER the server accepted it. The server keeps generating and persists the
 * result to studio_courses on its own (lib/http/keep-alive.ts), so the client
 * reads it back instead of POSTing again — a second POST would reserve the
 * student's quota a second time for the same content.
 *
 * Accepts a value only when it was saved by THIS request: `savedAfter` is the
 * server's own clock at acceptance (same clock that stamps `updated_at`), and
 * the value must differ from what the client already had (a sibling section
 * saving bumps the row's `updated_at` too). Resolves null once `deadlineAt`
 * passes without a match — the server failed (and refunded) or never ran.
 */
export async function waitForSavedStudioSection(options: {
  courseId: number;
  section: JsonSectionId;
  savedAfter: number;
  deadlineAt: number;
  previousJson: string | null;
}): Promise<unknown | null> {
  const { courseId, section, savedAfter, deadlineAt, previousJson } = options;
  while (Date.now() < deadlineAt) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      const res = await fetch(`/api/studio/courses/${courseId}/section?section=${encodeURIComponent(section)}`, { cache: "no-store" });
      if (!res.ok) continue;
      const body = (await res.json()) as { success?: boolean; data?: unknown; updatedAt?: string | null };
      if (!body.success || body.data === null || body.data === undefined) continue;
      const updatedAt = body.updatedAt ? Date.parse(body.updatedAt) : NaN;
      if (!Number.isFinite(updatedAt) || updatedAt < savedAfter) continue;
      if (previousJson !== null && JSON.stringify(body.data) === previousJson) continue;
      return body.data;
    } catch {
      // Still offline — keep polling until the deadline.
    }
  }
  return null;
}
