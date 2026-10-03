/**
 * Cleans an assistant reply so the student only ever sees the answer itself:
 *  1. Internal "chain of thought" wrapped in <think>…</think> /
 *     <thinking>…</thinking> (some models in FREE_MODEL_CHAIN — see
 *     app/api/courses/chat/route.ts — emit their private reasoning this
 *     way before the real answer).
 *  2. Prompt echo / meta-commentary that some models write BEFORE the answer
 *     ("The user is asking me to explain…", "L'étudiant me demande…",
 *     "Agis comme un professeur…", "Okay, let me think…"). Only LEADING
 *     paragraphs are ever removed, and only when they match a narrow set of
 *     meta openers — a real answer paragraph is never touched.
 *
 * `stripReasoning` is safe to call on every partial chunk while a reply is
 * still streaming in:
 *  - a fully-closed reasoning block is removed outright;
 *  - an unclosed block still streaming (`<think>` seen, `</think>` not yet)
 *    drops everything from the opening tag to the current end, so the bubble
 *    stays empty until the real answer starts;
 *  - idempotent, and a no-op (apart from a trim) on text with neither.
 *
 * `createReplyCleaner` applies the same rules to the SERVER-side byte stream
 * (lib/ai/openrouter.ts's streamOpenRouter), holding back only the first few
 * words when they could still turn out to be a meta opener, so nothing is
 * ever sent to the client and then retracted.
 */

/** Narrow openers of a leading meta paragraph. Matched at the START of a paragraph only. */
const META_OPENERS: RegExp[] = [
  // English: narrating the request
  /^(?:okay|alright)[,.!]?\s+(?:so\s+)?(?:the\s+(?:user|student)|let me|let's|i\b)/i,
  /^the (?:user|student) (?:is asking|asks|asked|wants|would like|needs|is requesting|has (?:asked|provided|selected|highlighted)|provided|selected)/i,
  /^(?:let me|let's|i need to|i should|i will|i'll|i must) (?:think|analy[sz]e|break (?:this|it)|start by|figure|reason|consider|understand|first)/i,
  // French: narrating the request
  /^(?:l['’]\s?)?(?:étudiant|utilisateur)(?:\(e\))? (?:me demande|demande|veut|souhaite|a (?:demandé|sélectionné|surligné|fourni)|pose)/i,
  // Narrow on purpose: "Je vais identifier trois pièges :" is real content, "Je dois d'abord analyser la demande" is not.
  /^(?:je dois|il faut que je|je vais) (?:d['’]abord |tout d['’]abord |commencer par )?(?:analyser|réfléchir (?:à|sur)|reformuler|décomposer|comprendre) (?:la |le |cette |ce |l['’])?(?:question|demande|requête|texte|passage|consigne|sujet|problème)/i,
  /^(?:d['’]accord|compris)[,.!]?\s+(?:je dois|l['’]étudiant|voyons|analysons)/i,
  // Prompt echo: the persona / instruction repeated back
  /^(?:agis|agissez|agir)\s+(?:comme|en tant que)\b/i,
  /^(?:tu es|vous êtes|you are)\s+(?:un |une |a |an )?(?:professeur de m[ée]decine|m[ée]decin enseignant|assistant|medart|expert|professor)/i,
  /^(?:system|système)\s*(?:prompt|message|instruction)s?\s*:/i,
  /^(?:réflexion|thinking|analyse de la demande)\s*:/i,
];

/**
 * Lower-cased starts that COULD still grow into one of the openers above.
 * Used only to decide whether the very beginning of a stream must be held
 * back for a moment — never to remove anything.
 */
const META_PREFIXES = [
  "the user", "the student", "okay", "alright", "let me", "let's", "i need", "i should", "i will", "i'll", "i must",
  "l'étudiant", "l’étudiant", "l'utilisateur", "l’utilisateur", "étudiant", "utilisateur",
  "je dois", "je vais", "il faut que", "d'accord", "d’accord", "compris",
  "agis", "tu es", "vous êtes", "you are", "system", "système", "réflexion", "thinking", "analyse de",
];

function isMetaParagraph(paragraph: string): boolean {
  const text = paragraph.trimStart();
  return META_OPENERS.some((pattern) => pattern.test(text));
}

/** True while `text` (the start of the reply) might still become a meta opener — the stream cleaner waits on it. */
function mayBecomeMeta(text: string): boolean {
  const start = text.trimStart().toLowerCase();
  if (!start) return true;
  return META_PREFIXES.some((prefix) => start.startsWith(prefix) || prefix.startsWith(start));
}

/** Removes leading meta/prompt-echo paragraphs (never anything after the first real paragraph). */
function stripLeadingMeta(text: string): string {
  let rest = text.trimStart();
  for (;;) {
    const breakAt = rest.search(/\r?\n\s*\r?\n/);
    const first = breakAt === -1 ? rest : rest.slice(0, breakAt);
    if (!first || !isMetaParagraph(first)) return rest;
    if (breakAt === -1) return ""; // the whole (still-streaming) text is one meta paragraph
    rest = rest.slice(breakAt).trimStart();
  }
}

export function stripReasoning(content: string): string {
  if (!content) return "";
  const withoutThinking = content
    // Fully-closed reasoning blocks (completed) — <think>…</think> / <thinking>…</thinking>.
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    // A still-open reasoning block that hasn't been closed yet (streaming) —
    // drop from the opening tag to the end so nothing after it leaks either.
    .replace(/<think(?:ing)?>[\s\S]*$/i, "")
    .trim();
  return stripLeadingMeta(withoutThinking).trim();
}

/**
 * Server-side stream filter: text in → cleaned text out, same bytes-in /
 * bytes-out shape streamOpenRouter already returns. Never emits something
 * it would later have to take back:
 *  - the start of the reply is held until it can no longer become a meta
 *    opener (or 160 characters have arrived, or the first paragraph ended);
 *  - a trailing "<" / "<thi…" that might be the start of a reasoning tag is
 *    held until the next chunk shows what it is.
 * `flush` releases whatever is left, cleaned.
 */
export function createReplyCleaner(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let raw = "";
  let emitted = 0;
  let started = false;

  const HOLD_LIMIT = 160;
  const TAG_STARTS = ["<think>", "<thinking>"];

  /** Length of the trailing fragment that is a proper prefix of a reasoning tag. */
  function pendingTagLength(cleaned: string): number {
    const lt = cleaned.lastIndexOf("<");
    if (lt === -1) return 0;
    const tail = cleaned.slice(lt).toLowerCase();
    return TAG_STARTS.some((tag) => tag.startsWith(tail) && tail.length < tag.length) ? cleaned.length - lt : 0;
  }

  function release(controller: TransformStreamDefaultController<Uint8Array>, final: boolean) {
    const cleaned = stripReasoning(raw);
    if (!started) {
      const firstParagraphDone = /\r?\n\s*\r?\n/.test(cleaned);
      const undecided = !final && !firstParagraphDone && cleaned.length < HOLD_LIMIT && mayBecomeMeta(cleaned);
      if (undecided) return;
      started = true;
    }
    const safeEnd = final ? cleaned.length : cleaned.length - pendingTagLength(cleaned);
    if (safeEnd > emitted) {
      controller.enqueue(encoder.encode(cleaned.slice(emitted, safeEnd)));
      emitted = safeEnd;
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      raw += decoder.decode(chunk, { stream: true });
      release(controller, false);
    },
    flush(controller) {
      raw += decoder.decode();
      release(controller, true);
    },
  });
}
