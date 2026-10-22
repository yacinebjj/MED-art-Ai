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
  /**
   * What this payment buys (monetization v2). Absent on checkouts created
   * before v2 = "individual".
   *  - "individual": the payer's own plan.
   *  - "group_leader": the payer buys the 5 Groupe seats at once.
   *  - "pool_member": the payer's share of a pooled Promo / Groupe (poolId).
   */
  kind?: "individual" | "group_leader" | "pool_member";
  poolId?: string;
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

/**
 * Chargily itself is unreachable or overloaded — a network failure, a
 * timeout, a 5xx (its Cloudflare front answers 502/504 when its servers or the
 * Algérie Poste / CIB network behind them stall) or a 429. Distinct from a 4xx
 * on our own request, so callers can tell the student "try again in a few
 * minutes" instead of a generic failure.
 */
export class ChargilyUnavailableError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`Chargily unavailable (${status || "network"}): ${detail}`);
    this.name = "ChargilyUnavailableError";
  }
}

/** A checkout creation that has not answered by then will not: the student gets a clear message instead of a spinner. */
const CHECKOUT_CREATE_TIMEOUT_MS = 20_000;

export async function createChargilyCheckout(
  params: CreateCheckoutParams
): Promise<ChargilyCheckout> {
  let res: Response;
  try {
    res = await fetch(`${CHARGILY_API_BASE}/checkouts`, {
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
      signal: AbortSignal.timeout(CHECKOUT_CREATE_TIMEOUT_MS),
    });
  } catch (error) {
    // Timeout (AbortSignal) or network failure: no answer from Chargily at all.
    throw new ChargilyUnavailableError(0, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status >= 500 || res.status === 429) throw new ChargilyUnavailableError(res.status, body.slice(0, 300));
    throw new Error(`Chargily checkout creation failed (${res.status}): ${body.slice(0, 500)}`);
  }

  return (await res.json()) as ChargilyCheckout;
}

/** Outcome of a call that never throws: `status` is the HTTP status, 0 when the request itself failed. */
export type ChargilyCallResult<T> = { ok: true; data: T } | { ok: false; status: number };

const CHARGILY_CALL_TIMEOUT_MS = 10_000;

async function chargilyCall<T>(path: string, method: "GET" | "POST"): Promise<ChargilyCallResult<T>> {
  try {
    const res = await fetch(`${CHARGILY_API_BASE}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${getSecretKey()}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(CHARGILY_CALL_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (error) {
    console.error(`[chargily] ${method} ${path} failed:`, error instanceof Error ? error.message : error);
    return { ok: false, status: 0 };
  }
}

/**
 * GET /checkouts/{id} — the checkout's current state, with the amount,
 * currency and metadata it was created with. Status is one of "pending" |
 * "processing" | "paid" | "failed" | "canceled". Never throws.
 */
export async function getChargilyCheckout(id: string): Promise<ChargilyCallResult<ChargilyCheckout>> {
  return chargilyCall(`checkouts/${encodeURIComponent(id)}`, "GET");
}

/**
 * POST /checkouts/{id}/expire — makes a still-pending checkout unpayable.
 * Chargily answers 400 when the checkout already expired (checkouts expire
 * on their own after 30 minutes) and 403 when it is no longer pending
 * (processing, paid, failed or canceled). Never throws.
 */
export async function expireChargilyCheckout(id: string): Promise<ChargilyCallResult<unknown>> {
  return chargilyCall(`checkouts/${encodeURIComponent(id)}/expire`, "POST");
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
