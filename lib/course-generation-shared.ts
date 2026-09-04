/**
 * Generic helpers shared across nearly every AI-generation and Supabase-write
 * route in this app (errorMessage, sanitizeForPostgres, parseJsonResponse,
 * slugify, stripDangerousHtml, MAX_SOURCE_CHARS) — imported by dozens of
 * files, NOT specific to any one pipeline.
 *
 * Used to ALSO hold the "cours indépendant" modular-generation pipeline
 * (generateCourseSection, its Smart Clone/chunk-delta machinery, the 6
 * app/api/generate/* route wrappers) — that whole pipeline, and the
 * `courses` table it wrote to, was retired by explicit product direction
 * (replaced by "Audio to Smart Notes" — see app/dashboard/audio-workspace).
 * If you're looking for that logic, it's gone, not moved — the Studio
 * pipeline (app/api/studio/generate/route.ts, `studio_courses`) is the one
 * real course-content pipeline in this app now.
 */

/** Postgres refuses any text/jsonb value containing a NUL byte (U+0000) --
 * insert/update fails with `22P05 unsupported Unicode escape sequence`,
 * confirmed live against this exact table. PDF extraction (officeparser)
 * and, more rarely, the model's own output can both introduce a stray NUL.
 * Strips it (and other C0 control characters that aren't legitimate
 * whitespace) from every string, at every depth, in place before anything
 * gets near Supabase.
 */
const POSTGRES_UNSAFE_CONTROL_CHARS = new RegExp("[" + "\x00-\x08\x0B\x0C\x0E-\x1F" + "]", "g");

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // strip combining diacritical marks (accents) left by NFD normalization
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function sanitizeForPostgres<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(POSTGRES_UNSAFE_CONTROL_CHARS, "") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPostgres(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeForPostgres(val);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Server-side defensive strip for HTML content coming from a `contentEditable`
 * surface (see app/api/notes/route.ts — "Mes notes" saves `innerHTML`, which
 * can carry pasted `<script>`/event-handler attributes/`javascript:` URIs).
 * This is a coarse regex backstop, NOT a full sanitizer — the real, thorough
 * allowlist sanitization is `lib/highlight.ts`'s `sanitizeNoteHtml`, which
 * runs client-side before every save (it needs DOM APIs, unavailable here).
 * This function exists because a client can always bypass the browser and
 * POST/PUT directly to this route, so the server must not rely on the client
 * having sanitized anything — it strips the specific, genuinely dangerous
 * constructs (script/style execution, inline event handlers, javascript:
 * navigation) regardless of what the client already did.
 */
export function stripDangerousHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed|link|meta|form)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, "");
}

/** Formats any thrown value into a plain string message, never leaking `[object Object]`. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Strips Markdown code-fence wrapping the model sometimes adds despite
 * explicit instructions not to (the "```json ... ```" trap) — handles a
 * fence anywhere in the string, not just at the very start/end, since the
 * model occasionally prefixes a sentence before the fenced block too.
 */
function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const closedFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (closedFence) return closedFence[1].trim();

  // No CLOSING fence found — this is what a response cut off mid-fence looks
  // like (hit max_tokens before ever reaching the closing "```"). Strip just
  // the leading "```json" marker so the truncation-repair pass below isn't
  // fighting stray backticks on top of unbalanced brackets; without this, a
  // truncated fenced response failed to parse for TWO compounding reasons
  // (leftover fence text AND unbalanced JSON), and repairTruncatedJson only
  // ever fixes the second one.
  const openFenceOnly = trimmed.match(/^```(?:json)?\s*([\s\S]*)$/i);
  if (openFenceOnly) return openFenceOnly[1].trim();

  return trimmed;
}

/**
 * Best-effort repair for a JSON string cut off mid-structure — the classic
 * signature of a response hitting max_tokens before finishing. Closes any
 * string left open at the point of truncation, drops a dangling trailing
 * comma (left by a cut-off array/object entry), then closes every
 * still-open `{`/`[` in the correct reverse order.
 *
 * Returns `null` when there's nothing bracket/string-shaped to repair (the
 * original failure wasn't a truncation, e.g. the model returned prose
 * instead of JSON) — parseJsonResponse falls back to its original error in
 * that case, never silently swallowing a genuinely different failure.
 *
 * This recovers a PARTIAL but validly-shaped result (e.g. 6 of 8 requested
 * QCMs instead of 8) — it never fabricates missing content, and a caller's
 * own schema validation (exact counts, required fields, etc.) is still what
 * catches an under-filled result downstream and triggers that route's
 * existing retry logic. This function's only job is turning a hard
 * JSON.parse crash into a recoverable, honestly-incomplete object.
 */
function repairTruncatedJson(text: string): string | null {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  if (!inString && stack.length === 0) return null; // balanced already — not a truncation-shaped failure.

  let repaired = text;
  if (inString) {
    // A response cut off immediately after a lone, unescaped backslash
    // (e.g. mid-escape-sequence) ends this scan with `escaped === true` —
    // blindly appending `"` in that state would be read by JSON.parse as
    // an ESCAPED quote (`\"`), not a closing one, leaving the string still
    // unterminated and the whole repair attempt silently useless. Drop
    // that dangling backslash (it's already a broken, incomplete escape —
    // nothing valid to preserve) before closing the string for real.
    if (escaped) repaired = repaired.slice(0, -1);
    repaired += '"';
  }
  repaired = repaired.replace(/,\s*$/, ""); // a truncated array/object entry often leaves a dangling trailing comma.
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === "{" ? "}" : "]";
  }
  return repaired;
}

/**
 * Two DISTINCT, confirmed real production failures — neither is a
 * truncation, so repairTruncatedJson's bracket-balancing can't fix either
 * (nothing is actually unbalanced in either case), and a genuinely complete
 * response was being discarded as if it were cut off:
 *
 * 1. INVALID ESCAPE TARGET — `SyntaxError: Unexpected token '\'` (or, on
 *    newer V8, "Bad escaped character in JSON") right before a heading like
 *    "Hiérarchie": the model writes a literal backslash that isn't a valid
 *    JSON escape target (`\H` is not `"`, `\`, `/`, `b`, `f`, `n`, `r`, `t`,
 *    or `u`), almost certainly a stray LaTeX-ish artifact (e.g. an
 *    abandoned `\hline`-style table command).
 * 2. RAW CONTROL CHARACTER IN A STRING — same class of error (message
 *    varies by Node/V8 version — "Bad control character in string
 *    literal" on newer V8, the same generic "Unexpected token" on older
 *    versions this app's production server was confirmed running),
 *    context snippet showing something like a real linebreak followed by
 *    an ASCII table divider (`+-------+`): the model draws a plain-text/
 *    ASCII-art table (needs REAL line breaks between rows) instead of a
 *    single-line Markdown table, and that raw newline/tab/CR byte ends up
 *    sitting unescaped inside what's supposed to be one JSON string value
 *    — valid JSON requires control characters to be written as `\n`/`\t`/
 *    `\r`, never as a literal byte.
 *
 * Fixes both in one pass: doubles any invalid-target backslash into a
 * valid `\\` (the only sane reading of "there was a literal backslash
 * here"), and escapes any raw control character (code point < 0x20) found
 * inside a string into its proper JSON escape. Never touches any other
 * character — never removes or invents content.
 */
// Exported — lib/studio-explication-delta.ts's own escapeKnownStringBody
// reuses these exact two tables for a structurally-anchored recovery that
// (unlike fixInvalidJsonEscapes below) never toggles in/out of "string
// mode" on a bare quote, so it can't share fixInvalidJsonEscapes' own
// per-call logic directly, but must stay byte-for-byte consistent with what
// counts as a valid JSON escape target / control-character encoding.
export const VALID_JSON_ESCAPE_TARGETS = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);
export const CONTROL_CHAR_ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };

/**
 * `startInString` — exported for lib/studio-explication-delta.ts's
 * recoverExplicationOnly, which runs this over an ALREADY-EXTRACTED string
 * BODY (the regex capture group between the outer quotes, never containing
 * a bare unescaped `"` by construction) rather than a full `{...}`
 * document — the whole input there IS string content from the start, so
 * there's no opening `"` for the normal in/out toggle below to ever see.
 */
export function fixInvalidJsonEscapes(text: string, startInString = false): string {
  let result = "";
  let inString = startInString;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (inString && ch === "\\") {
      const next = text[i + 1];
      if (next !== undefined && VALID_JSON_ESCAPE_TARGETS.has(next)) {
        result += ch;
        escaped = true;
      } else {
        result += "\\\\"; // invalid escape target — treat the backslash as a literal character.
      }
      continue;
    }

    if (inString && ch < " ") {
      // Raw control character sitting unescaped inside a string — valid
      // JSON forbids this outright, regardless of which character it is.
      result += CONTROL_CHAR_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }

    if (ch === '"') inString = !inString;
    result += ch;
  }

  return result;
}

/** Parses the model's raw output into a plain object, with a clear error on malformed/truncated JSON. Tries fixInvalidJsonEscapes() and repairTruncatedJson() (independently, then combined) as fallbacks before giving up — see each function's own comment for exactly what it does and doesn't fix. */
export function parseJsonResponse(raw: string): Record<string, unknown> {
  const cleaned = stripMarkdownFences(sanitizeForPostgres(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (firstError) {
    // Try each candidate in order, from least to most invasive — an
    // invalid-escape fix alone succeeds when the document was already
    // complete; the truncation repair alone succeeds when escaping was
    // already fine; both together cover a response that is BOTH cut off
    // AND contains a stray backslash earlier on (confirmed to happen
    // together in real production output).
    const escapeFixed = fixInvalidJsonEscapes(cleaned);
    const candidates = [escapeFixed, repairTruncatedJson(cleaned), repairTruncatedJson(escapeFixed)].filter(
      (c): c is string => typeof c === "string" && c !== cleaned
    );

    let recovered = false;
    for (const candidate of candidates) {
      try {
        parsed = JSON.parse(candidate);
        recovered = true;
        console.warn(
          "[course-generation] JSON invalide (échappement ou troncature) détecté et réparé automatiquement (résultat potentiellement incomplet — la validation de schéma en aval reste responsable de détecter un contenu insuffisant)."
        );
        break;
      } catch {
        // try the next candidate
      }
    }

    if (!recovered) {
      console.error("[course-generation] JSON.parse failed (même après réparation):", firstError, "\nRaw output (first 1000 chars):", raw.slice(0, 1000));
      throw new Error("L'IA a renvoyé un JSON invalide ou tronqué (limite de tokens atteinte). Réessaie.");
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("L'IA n'a pas renvoyé un objet JSON à la racine.");
  }

  return parsed as Record<string, unknown>;
}

export const MAX_SOURCE_CHARS = 60_000; // matches the cap used by the rest of the app's AI pipeline
