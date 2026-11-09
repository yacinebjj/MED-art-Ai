import { stripReasoning } from "@/lib/strip-reasoning";

/**
 * CONVERSATION MEMORY for both Copilots — product order 2026-11-09 ("Master
 * Copilot Surgery"): the Workspace Copilot (app/api/courses/chat) and the
 * Dashboard Copilot (app/api/dashboard-assistant) answer with the whole
 * conversation in mind, not just its last few messages.
 *
 *  - The page sends the conversation as `history` (compactHistoryForUpload
 *    bounds the upload: recent turns word for word, older ones condensed).
 *  - The route reads it (normalizeChatHistory): every well-formed turn is
 *    kept; a failed reply ("⚠️ …"), an empty bubble and leaked reasoning are
 *    dropped, and the turns alternate student → Copilot, as every chat
 *    template expects.
 *  - Each model gets what fits its budget (selectHistory): the most recent
 *    turns word for word (a very long answer keeps its beginning and its
 *    end), everything older as a condensed CONVERSATION MEMORY in the system
 *    prompt — so "my first question" or "the other disease you mentioned"
 *    still means something forty messages later.
 *
 * Pure and client-safe: the pages and the routes share it.
 */

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** How much of the conversation one model is sent. Keep `verbatimChars` at least twice `turnChars`: the last exchange always fits. */
export interface HistoryBudget {
  /** The most recent turns, word for word, up to this many characters in all. */
  verbatimChars: number;
  /** A single turn longer than this keeps its beginning and its end. A full 8192-token answer is about 35,000 characters. */
  turnChars: number;
  /** Everything older is condensed into the conversation memory, up to this many characters. */
  memoryChars: number;
}

/** The free models (no cost, 256K-token context on Omni): about 35k tokens of verbatim history. */
export const FREE_MODEL_HISTORY_BUDGET: HistoryBudget = { verbatimChars: 120_000, turnChars: 40_000, memoryChars: 16_000 };

/** A paid fallback (qwen3.7-flash: $0.03 per million input tokens): the same memory, a shorter verbatim window. */
export const PAID_FALLBACK_HISTORY_BUDGET: HistoryBudget = { verbatimChars: 32_000, turnChars: 12_000, memoryChars: 8_000 };

/** Only the most recent entries of a (huge or hostile) array are even looked at. */
const MAX_TURNS_READ = 400;
/** In the memory (and in the page's upload of older turns): a question this long, an answer's opening this long. */
const CONDENSED_QUESTION_CHARS = 300;
const CONDENSED_ANSWER_CHARS = 500;
/** An older answer's opening once the memory runs short of room. */
const BRIEF_ANSWER_CHARS = 160;
/** Older turns the page sends, condensed, before the recent ones: 80 exchanges. Even, so the upload starts on a question. */
const MAX_UPLOADED_OLDER_TURNS = 160;
const CLIP_MARK = "\n\n[…]\n\n";

const ROLES = new Map<string, ChatHistoryTurn["role"]>([
  ["user", "user"],
  ["human", "user"],
  ["student", "user"],
  ["assistant", "assistant"],
  ["ai", "assistant"],
  ["bot", "assistant"],
  ["model", "assistant"],
]);

const MEMORY_HEADER =
  "MÉMOIRE DE LA CONVERSATION — les échanges plus anciens de cette même conversation, condensés (les échanges récents suivent en entier, comme messages). Ils font partie du fil : quand l'étudiant y fait référence (« ma première question », « comme tu disais », « et pour l'autre ? »), appuie-toi dessus, sans les répéter.";

/** A reply that failed: both pages write one short "⚠️ …" line in place of the answer. */
export function isFailedReply(content: string): boolean {
  const text = content.trim();
  return text.startsWith("⚠️") && text.length < 400 && !text.includes("\n");
}

/** A turn's text: a string, or the text parts of an OpenAI-style content array (an old image is never re-sent). */
function readContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const texts = value
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .filter(Boolean);
  return texts.length > 0 ? texts.join("\n") : null;
}

/**
 * The conversation as sent by a page, made safe and well-formed for a model:
 * known roles only (assistant/ai/bot/model and user/human/student), text
 * only, failed and empty replies dropped, reasoning stripped, consecutive
 * turns of one role merged, opening on a question and closing on an answer
 * (an unanswered question at the end is the one being retried or replaced
 * by the new message).
 */
export function normalizeChatHistory(raw: unknown): ChatHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatHistoryTurn[] = [];
  for (const entry of raw.slice(-MAX_TURNS_READ)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { role?: unknown; content?: unknown };
    const role = typeof candidate.role === "string" ? ROLES.get(candidate.role.trim().toLowerCase()) : undefined;
    const text = readContent(candidate.content);
    if (!role || text === null) continue;
    const content = (role === "assistant" ? stripReasoning(text) : text).trim();
    if (!content || (role === "assistant" && isFailedReply(content))) continue;
    const previous = turns[turns.length - 1];
    if (previous && previous.role === role) previous.content = `${previous.content}\n\n${content}`;
    else turns.push({ role, content });
  }
  while (turns.length > 0 && turns[0].role !== "user") turns.shift();
  while (turns.length > 0 && turns[turns.length - 1].role !== "assistant") turns.pop();
  return turns;
}

/** The first `max` UTF-16 units of `text`, never ending on half a surrogate pair. */
function cutEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** The last `max` UTF-16 units of `text`, never starting on half a surrogate pair. */
function cutStart(text: string, max: number): string {
  if (text.length <= max) return text;
  let start = text.length - Math.max(0, max);
  const first = text.charCodeAt(start);
  if (first >= 0xdc00 && first <= 0xdfff) start += 1;
  return text.slice(start);
}

/** A turn within `max` characters: its beginning and its end (an answer's conclusion matters as much as its opening). */
function clipTurn(content: string, max: number): string {
  if (content.length <= max) return content;
  const room = Math.max(0, max - CLIP_MARK.length);
  const head = Math.ceil(room * 0.7);
  return `${cutEnd(content, head).trimEnd()}${CLIP_MARK}${cutStart(content, room - head).trimStart()}`;
}

/** One line of the memory: no images, no citation markers, no line breaks, at most `max` characters. */
function condense(content: string, max: number): string {
  const text = content
    .replace(/!\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, (_, alt: string) => `[image : ${alt.trim() || "illustration"}]`)
    .replace(/\[\[\s*source:[^\]]*\]\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${cutEnd(text, max - 1).trimEnd()}…` : text;
}

/** Where the word-for-word window opens: as many recent turns as fit, starting on a question. */
function verbatimStart(turns: ChatHistoryTurn[], budget: HistoryBudget): number {
  let start = turns.length;
  let used = 0;
  while (start > 0) {
    const size = Math.min(turns[start - 1].content.length, budget.turnChars);
    if (used + size > budget.verbatimChars) break;
    used += size;
    start -= 1;
  }
  while (start < turns.length && turns[start].role !== "user") start += 1;
  return start;
}

interface PastExchange {
  question: string | null;
  answer: string | null;
}

/** One numbered entry of the memory: the question, and the opening of its answer when `answerChars` > 0. */
function memoryEntry(exchange: PastExchange, answerChars: number): string {
  const lines: string[] = [];
  if (exchange.question !== null) lines.push(`Étudiant : « ${condense(exchange.question, CONDENSED_QUESTION_CHARS)} »`);
  if (exchange.answer !== null && answerChars > 0) lines.push(`Toi : « ${condense(exchange.answer, answerChars)} »`);
  return lines.join("\n   ");
}

/**
 * The older exchanges, condensed, or null when there are none. Within
 * `maxChars`: first every question, newest first (what the student asked is
 * what they refer back to); then the openings of the answers, newest first —
 * a full opening while there is room, a shorter one after that. Exchanges
 * that don't fit even as a question are counted, not listed.
 */
function conversationMemory(older: ChatHistoryTurn[], maxChars: number): string | null {
  const exchanges: PastExchange[] = [];
  for (const turn of older) {
    const last = exchanges[exchanges.length - 1];
    if (turn.role === "user") exchanges.push({ question: turn.content, answer: null });
    else if (last && last.answer === null) last.answer = turn.content;
    else exchanges.push({ question: null, answer: turn.content });
  }
  // Room for the header and the "older exchanges left out" line; 6 per entry for its number and line break.
  const budget = maxChars - MEMORY_HEADER.length - 80;
  let used = 0;
  let first = exchanges.length;
  while (first > 0) {
    const size = memoryEntry(exchanges[first - 1], 0).length + 6;
    if (used + size > budget) break;
    used += size;
    first -= 1;
  }
  if (first === exchanges.length) return null;

  const answerChars = new Array<number>(exchanges.length).fill(0);
  for (let index = exchanges.length - 1; index >= first; index--) {
    const bare = memoryEntry(exchanges[index], 0).length;
    for (const chars of [CONDENSED_ANSWER_CHARS, BRIEF_ANSWER_CHARS]) {
      const extra = memoryEntry(exchanges[index], chars).length - bare;
      if (used + extra <= budget) {
        used += extra;
        answerChars[index] = chars;
        break;
      }
    }
  }

  const entries = exchanges.slice(first).map((exchange, offset) => memoryEntry(exchange, answerChars[first + offset])).filter(Boolean);
  if (entries.length === 0) return null;
  const omittedLine = first > 0 ? `(${first} échange${first > 1 ? "s" : ""} plus ancien${first > 1 ? "s" : ""} non repris ici.)\n` : "";
  return `${MEMORY_HEADER}\n${omittedLine}${entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n")}`;
}

export interface SelectedHistory {
  /** Sent as chat messages, word for word (a very long turn clipped in its middle). */
  recent: ChatHistoryTurn[];
  /** The older exchanges, condensed, for the system prompt — null when everything fits in `recent`. */
  memory: string | null;
}

/** What one model is sent of a normalized conversation (normalizeChatHistory), within `budget`. */
export function selectHistory(turns: ChatHistoryTurn[], budget: HistoryBudget): SelectedHistory {
  const start = verbatimStart(turns, budget);
  return {
    recent: turns.slice(start).map((turn) => ({ role: turn.role, content: clipTurn(turn.content, budget.turnChars) })),
    memory: conversationMemory(turns.slice(0, start), budget.memoryChars),
  };
}

/**
 * The page's side: the conversation to send as `history`, bounded — the
 * turns a free model reads word for word, as they are, and up to 80 older
 * exchanges condensed (all a model ever gets of them). A long thread no
 * longer re-uploads every past answer in full with each new question.
 */
export function compactHistoryForUpload(messages: readonly { role: string; content: string }[]): ChatHistoryTurn[] {
  const turns = normalizeChatHistory(messages);
  const start = verbatimStart(turns, FREE_MODEL_HISTORY_BUDGET);
  const older = turns
    .slice(Math.max(0, start - MAX_UPLOADED_OLDER_TURNS), start)
    .map((turn) => ({ role: turn.role, content: condense(turn.content, turn.role === "user" ? CONDENSED_QUESTION_CHARS : CONDENSED_ANSWER_CHARS) }));
  const recent = turns.slice(start).map((turn) => ({ role: turn.role, content: clipTurn(turn.content, FREE_MODEL_HISTORY_BUDGET.turnChars) }));
  return [...older, ...recent];
}
