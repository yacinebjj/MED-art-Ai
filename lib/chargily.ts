import { createHmac, timingSafeEqual } from "crypto";

/**
 * Thin wrapper around Chargily Pay V2 (https://dev.chargily.com/pay-v2).
 * Base URL + secret key select test vs. live mode — there is no separate
 * "test mode" flag in the request itself.
 */
const CHARGILY_API_BASE =
  process.env.CHARGILY_API_BASE || "https://pay.chargily.net/test/api/v2";

function getSecretKey(): string {
  const key = process.env.CHARGILY_SECRET_KEY;
  if (!key) {
    throw new Error("CHARGILY_SECRET_KEY n'est pas configurée sur le serveur.");
  }
  return key;
}

/**
 * Exact shape this app puts into (and reads back out of) a checkout's
 * metadata — see app/api/chargily/checkout/route.ts for the write side and
 * app/api/chargily/webhook/route.ts for the read side. Chargily's own API
 * only requires string values and echoes whatever object it's given back
 * unchanged, so this is our own contract, not Chargily's — narrowed from a
 * bare `Record<string, string>` because exactly these three fields, and no
 * others, are ever written or read anywhere in this codebase.
 */
export interface ChargilyCheckoutMetadata {
  userId: string;
  plan: string;
  email: string;
}

export interface ChargilyCheckout {
  id: string;
  entity: "checkout";
  amount: number;
  currency: string;
  status: string;
  checkout_url: string;
  /**
   * Optional (not `| null`) rather than genuinely nullable: Chargily always
   * echoes back exactly what was sent at creation, and every checkout this
   * app creates always sends `metadata` (see CreateCheckoutParams below) —
   * so in practice this is only ever absent if a webhook payload has been
   * hand-crafted or corrupted, which the signature check upstream of every
   * read already guards against.
   */
  metadata?: ChargilyCheckoutMetadata;
}

export interface CreateCheckoutParams {
  amount: number;
  currency?: string;
  successUrl: string;
  failureUrl?: string;
  webhookEndpoint?: string;
  description?: string;
  locale?: "ar" | "en" | "fr";
  metadata?: ChargilyCheckoutMetadata;
}

export async function createChargilyCheckout(
  params: CreateCheckoutParams
): Promise<ChargilyCheckout> {
  const res = await fetch(`${CHARGILY_API_BASE}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency ?? "dzd",
      success_url: params.successUrl,
      failure_url: params.failureUrl,
      webhook_endpoint: params.webhookEndpoint,
      description: params.description,
      locale: params.locale ?? "fr",
      metadata: params.metadata,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Chargily checkout creation failed (${res.status}): ${body.slice(0, 500)}`);
  }

  return (await res.json()) as ChargilyCheckout;
}

/**
 * Verifies the `signature` header Chargily sends with every webhook:
 * HMAC-SHA256 of the raw request body, keyed with the API secret key.
 * Always pass the RAW body string (before JSON.parse) — re-serializing
 * the parsed object will not reproduce a matching signature.
 */
export function verifyChargilySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", getSecretKey()).update(rawBody).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(signatureHeader, "hex");

  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
