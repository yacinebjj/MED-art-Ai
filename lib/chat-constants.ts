/**
 * Course-context character cap for the course chat (app/api/courses/chat/route.ts,
 * which hard-truncates `sourceText` at this length before it ever reaches the
 * model). Pulled out into its own zero-dependency file — not exported
 * straight from the route — so client components (ChatDocumentPanel, warning
 * the student when their course exceeds it) can import the exact same number
 * without pulling that route's server-only imports (Supabase admin client,
 * etc.) into the client bundle.
 */
export const CHAT_MAX_CONTEXT_CHARS = 20_000;
