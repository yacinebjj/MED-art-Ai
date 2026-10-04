/**
 * Cross-student cache of paid AI results computed from an uploaded FILE
 * (table ai_file_cache), keyed by the sha256 of the file's bytes + a kind:
 *  - "ocr": text extracted by app/api/upload/finalize-ocr (Mistral OCR +
 *    vision model, billed per page) — the same scanned polycopié uploaded by
 *    a whole promotion is OCR'd once.
 *  - "exam-style": style profile extracted by app/api/exam/analyze-reference
 *    from an old exam paper — the same annale is analysed once.
 * Results are only stored after the caller validated them. Fail-open both
 * ways: a cache error never blocks the real (paid) path.
 */

import { createHash } from "crypto";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export type AiFileCacheKind = "ocr" | "exam-style";

export function fileSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function lookupFileResult<T>(kind: AiFileCacheKind, sha: string): Promise<T | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("ai_file_cache")
      .select("result")
      .eq("file_sha256", sha)
      .eq("kind", kind)
      .maybeSingle<{ result: T }>();
    if (error) {
      console.error(`[ai-file-cache:${kind}] Échec lecture (traitement réel utilisé):`, error.message);
      return null;
    }
    return data?.result ?? null;
  } catch (error) {
    console.error(`[ai-file-cache:${kind}] Exception lecture:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function storeFileResult(kind: AiFileCacheKind, sha: string, result: unknown): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseAdmin()
      .from("ai_file_cache")
      .upsert({ file_sha256: sha, kind, result }, { onConflict: "file_sha256,kind", ignoreDuplicates: true });
    if (error) console.error(`[ai-file-cache:${kind}] Échec écriture (non bloquant):`, error.message);
  } catch (error) {
    console.error(`[ai-file-cache:${kind}] Exception écriture (non bloquant):`, error instanceof Error ? error.message : error);
  }
}
