import crypto from "crypto";

/**
 * Signed, short-lived token for a client-driven Module Synthesis run
 * (plan → micro-batches → assemble). The plan step reserves ONE generation
 * unit and returns this token; the batch and assemble steps require it, so
 * they never reserve again — and cannot be called to generate for free
 * without a reserved run. Stateless (HMAC), bound to user, module and type.
 * Same secret convention as the case simulator's sealing key.
 */

const TOKEN_TTL_MS = 30 * 60_000;

function key(): Buffer | null {
  const secret = process.env.SYNTHESIS_RUN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return crypto.createHash("sha256").update("medart-synthesis-run:" + secret).digest();
}

function sign(payload: string, k: Buffer): string {
  return crypto.createHmac("sha256", k).update(payload).digest("base64url");
}

export function createSynthesisRunToken(userId: string, moduleId: number, type: string): string | null {
  const k = key();
  if (!k) return null;
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId}.${moduleId}.${type}.${expiresAt}`;
  return `${expiresAt}.${sign(payload, k)}`;
}

export function verifySynthesisRunToken(token: unknown, userId: string, moduleId: number, type: string): boolean {
  if (typeof token !== "string") return false;
  const k = key();
  if (!k) return false;
  const [expiresRaw, signature] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = Buffer.from(sign(`${userId}.${moduleId}.${type}.${expiresAt}`, k));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * Seals an intermediate payload (e.g. a batch of exam questions) to one run
 * token, so an assemble step can trust what the client hands back: anything
 * not produced by this server for this run fails verification.
 */
export function sealRunPayload(runToken: string, payload: string): string | null {
  const k = key();
  if (!k) return null;
  return sign(`payload.${runToken}.${payload}`, k);
}

export function verifyRunPayload(runToken: string, payload: string, seal: unknown): boolean {
  if (typeof seal !== "string") return false;
  const expected = sealRunPayload(runToken, payload);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(seal);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
