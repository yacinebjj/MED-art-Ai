/**
 * Transactional email through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
 * Server-only: RESEND_API_KEY must never reach the browser.
 *
 * Configuration (Vercel → Settings → Environment Variables):
 *  - RESEND_API_KEY  required; without it nothing is sent and nothing fails.
 *  - EMAIL_FROM      the verified sender, e.g. "MedArt AI <bonjour@your-domain>".
 *                    Resend only delivers to real students from a domain verified
 *                    in Resend; the onboarding@resend.dev fallback only reaches
 *                    the Resend account owner (testing).
 *  - EMAIL_REPLY_TO  optional reply address.
 *
 * sendEmail never throws: an email is a courtesy, never a reason for a sign-up
 * or a payment to fail. Every failure is logged (by tag, never the address)
 * and returned. The idempotency key makes Resend send a given message at most
 * once within 24 hours, even when two requests race to send it.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "MedArt AI <onboarding@resend.dev>";
const REQUEST_TIMEOUT_MS = 6000;
const RETRY_DELAY_MS = 600;

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key = same email: Resend sends it once per 24 hours. */
  idempotencyKey: string;
  /** Short label for logs and Resend tags (letters, digits, "_" and "-" only). */
  tag: string;
}

export type SendEmailResult = { ok: true; id: string } | { ok: false; reason: string };

let warnedNotConfigured = false;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

async function postOnce(body: string, idempotencyKey: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    if (!warnedNotConfigured) {
      console.warn("[email] RESEND_API_KEY is not set — transactional emails are disabled.");
      warnedNotConfigured = true;
    }
    return { ok: false, reason: "not_configured" };
  }

  const tag = message.tag.replace(/[^A-Za-z0-9_-]/g, "_");
  const body = JSON.stringify({
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
    tags: [{ name: "category", value: tag }],
  });

  // One retry for what is worth retrying (network error, timeout, 429, 5xx);
  // the idempotency key guarantees the retry can never produce a second email.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { status, json } = await postOnce(body, message.idempotencyKey);
      if (status >= 200 && status < 300 && typeof json.id === "string") return { ok: true, id: json.id };
      const reason = `${status} ${typeof json.message === "string" ? json.message : "unexpected response"}`;
      if (attempt === 2 || (status !== 429 && status < 500)) {
        console.error(`[email] ${tag} not sent: ${reason}`);
        return { ok: false, reason };
      }
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : error instanceof Error ? error.message : String(error);
      if (attempt === 2) {
        console.error(`[email] ${tag} not sent: ${reason}`);
        return { ok: false, reason };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  return { ok: false, reason: "unreachable" };
}
