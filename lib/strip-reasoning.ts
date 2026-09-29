/**
 * Removes a reasoning model's internal "chain of thought" from an assistant
 * reply so it never reaches the UI. Some free/cheap models this app routes
 * through (DeepSeek R1 via CHEAP_MODEL, and members of FREE_MODEL_CHAIN — see
 * app/api/courses/chat/route.ts) emit their private reasoning wrapped in
 * <think>...</think> (or <thinking>...</thinking>) before the real answer.
 * Rendering that mid-stream makes the app look like it's "thinking out loud",
 * slow and unfinished — this strips it.
 *
 * Handles BOTH states, which is what makes it safe to call on every partial
 * chunk while the reply is still streaming in:
 *  1. A fully-closed block (the reasoning arrived complete) — removed outright.
 *  2. An unclosed block still streaming (`<think>` seen, `</think>` not yet) —
 *     everything from the opening tag to the current end is dropped, so the
 *     bubble stays empty until the real answer starts, never flashing raw
 *     reasoning text for the frames before the closing tag lands.
 *
 * Idempotent and safe on content that has no tags at all (the overwhelming
 * common case): it just trims and returns the text unchanged.
 */
export function stripReasoning(content: string): string {
  if (!content) return "";
  return content
    // Fully-closed reasoning blocks (completed) — <think>…</think> / <thinking>…</thinking>.
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    // A still-open reasoning block that hasn't been closed yet (streaming) —
    // drop from the opening tag to the end so nothing after it leaks either.
    .replace(/<think(?:ing)?>[\s\S]*$/i, "")
    .trim();
}
