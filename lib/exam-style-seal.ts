import crypto from "crypto";
import type { ExamStyleProfile } from "@/lib/ai/exam-schemas";

/**
 * SERVER-ONLY. Seal of a reference-exam style profile, issued by
 * app/api/exam/analyze-reference with the profile it extracted, bound to the
 * student. A style exam may pool from and file into its archetype's SHARED
 * bank (lib/exam-bank-profiles.ts) only when its profile carries a valid
 * seal: the profile is sent back by the browser and becomes generation-prompt
 * text, so an unsealed or edited one is never allowed to write questions that
 * other students would receive — that exam is simply generated fresh, without
 * any bank. Same secret convention as lib/synthesis-run-token.ts, under its
 * own derivation label.
 */

function key(): Buffer | null {
  const secret = process.env.SYNTHESIS_RUN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return crypto.createHash("sha256").update("medart-exam-style-profile:" + secret).digest();
}

/** The profile's fields in a fixed order — the same profile always seals the same way. */
function canonical(userId: string, profile: ExamStyleProfile): string {
  return JSON.stringify([userId, profile.questionTypeDistribution, profile.trapPatterns, profile.optionFormatConventions, profile.difficultyAndVocabulary, profile.summary]);
}

export function sealStyleProfile(userId: string, profile: ExamStyleProfile): string | null {
  const k = key();
  return k ? crypto.createHmac("sha256", k).update(canonical(userId, profile)).digest("base64url") : null;
}

export function verifyStyleProfileSeal(userId: string, profile: ExamStyleProfile, seal: unknown): boolean {
  if (typeof seal !== "string" || !seal) return false;
  const expected = sealStyleProfile(userId, profile);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(seal);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
