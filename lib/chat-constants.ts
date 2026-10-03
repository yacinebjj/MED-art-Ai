/**
 * Course-context character cap for the course chat (app/api/courses/chat/route.ts,
 * which hard-truncates `sourceText` at this length before it ever reaches the
 * model). Pulled out into its own zero-dependency file — not exported
 * straight from the route — so client components (ChatDocumentPanel, warning
 * the student when their course exceeds it) can import the exact same number
 * without pulling that route's server-only imports (Supabase admin client,
 * etc.) into the client bundle.
 *
 * Was 20_000 — a real stress-test course (~40k chars, image/radiology-heavy)
 * exceeded it 2x, so the chat literally never saw over half the course, and
 * ChatDocumentPanel's "Ce cours est très long" banner fired for what is a
 * perfectly normal medical course length, not a genuine outlier. Claude
 * Sonnet 5's real context window is ~200k tokens (~700-800k characters for
 * French text) — 20_000 was an arbitrary, far-too-conservative cap relative
 * to what the model can actually read, not a real cost or capability limit.
 * Raised to 100_000: comfortably covers even a course 2.5x the size that
 * triggered this, while staying a small fraction of the real context window
 * (leaves ample room for persona, history, and the answer itself). This
 * block is also sent behind buildSystemContent's `cache_control: ephemeral`
 * breakpoint, so the extra size is mostly a ONE-TIME cache-write cost per
 * course, not a per-message multiplier — every later message in that (or
 * any other student's) conversation about the same course hits the cheap
 * cache-read price for it instead.
 */
export const CHAT_MAX_CONTEXT_CHARS = 100_000;

/**
 * Answer modes offered by the workspace composer's mode selector — the
 * server (lib/chat-system-prompt.ts's buildChatModeInstruction) turns each
 * into one extra instruction block. "standard" adds nothing, so a caller
 * that never sends a mode keeps the exact prompt it always had.
 */
export const CHAT_MODES = ["standard", "examen", "detaille", "express"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === "string" && (CHAT_MODES as readonly string[]).includes(value);
}

/**
 * Most courses one workspace chat turn may pull RAG chunks from (the
 * sources checked in the Sources panel). The retrieval budget itself stays
 * fixed (see lib/chat-context-retrieval.ts) — this only bounds the
 * ownership check and the chunk fetch.
 */
export const MAX_CHAT_SOURCE_COURSES = 6;
