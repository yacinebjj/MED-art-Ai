/**
 * Validates a client/URL-supplied "where to go after auth" path before it's
 * ever handed to a redirect — used by both app/auth/callback/route.ts
 * (server, post-email-confirmation) and components/auth/LoginForm.tsx
 * (client, post-sign-in). Both used to concatenate the raw `next` query
 * param straight into a redirect target with zero validation — a real,
 * confirmed open-redirect (CWE-601): a value like `@evil-phish.com` turns
 * `origin + next` into `https://med-art-ai-febc.vercel.app@evil-phish.com`,
 * which both `NextResponse.redirect` and the browser parse with
 * evil-phish.com as the actual host (the real origin becomes ignored
 * userinfo); `//evil.com` is the same trick via a protocol-relative URL.
 *
 * Requiring the result to start with exactly one `/` (never `//`, never a
 * backslash, never an embedded scheme, never a control character) forces it
 * to stay a same-origin, relative path no matter what the caller supplies —
 * anything else falls back to a safe default instead of failing the whole flow.
 *
 * Control characters: the URL parser every browser (and Node) uses DELETES
 * tab, LF and CR anywhere in a URL before reading it, so `/<TAB>/evil.com`
 * (`?next=/%09/evil.com`) passed every textual check above yet became
 * `//evil.com` inside router.push — a confirmed open redirect. Any C0
 * control or DEL is refused, and the result must still resolve to the same
 * origin as a last check, whatever other parser quirk exists.
 */
export function sanitizeRedirectPath(raw: unknown, fallback: string = "/dashboard"): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return fallback; // rejects "@evil.com", "https://evil.com", etc. — must be a path.
  if (trimmed.startsWith("//")) return fallback; // protocol-relative — same origin's browser still resolves this to a different host.
  if (trimmed.includes("\\")) return fallback; // some legacy URL parsers normalize backslashes to forward slashes.
  if (trimmed.includes("://")) return fallback; // an embedded scheme this far in is never legitimate for this app's own routes.
  if (hasControlCharacter(trimmed)) return fallback; // tab/LF/CR are deleted by the URL parser: "/\t/evil.com" → "//evil.com".
  if (!staysOnSameOrigin(trimmed)) return fallback;
  return trimmed;
}

/** Any ASCII control character (U+0000–U+001F) or DEL (U+007F). */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Resolved the way a browser resolves it, the path keeps the page's own origin. */
function staysOnSameOrigin(path: string): boolean {
  const base = "https://same-origin.invalid";
  try {
    return new URL(path, base).origin === base;
  } catch {
    return false;
  }
}
