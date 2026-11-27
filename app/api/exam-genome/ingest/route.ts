import { NextRequest, NextResponse } from "next/server";
import { GENOME_SESSIONS, GENOME_PROVENANCES, GENOME_SITTINGS } from "@/lib/exam-genome/scope";
import { fail, genomeContext, genomeErrorResponse, readJson } from "@/lib/exam-genome/http";
import { GenomeIngestError, ingestPaper, recordContribution, type DeclaredMeta } from "@/lib/exam-genome/ingest";
import { GENOME_BUCKET, isGenomeMimeType, isOwnGenomePath } from "@/lib/exam-genome/storage";
import { GenomeUnavailableError } from "@/lib/exam-genome/db";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Room left after the slow steps for the duplicate check and the transaction. */
const DEADLINE_MARGIN_MS = 45_000;

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | null => (typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null);
const int = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/**
 * EXAM GENOME, step 2 of a contribution: reads the uploaded paper and stores
 * it as needs_review (lib/exam-genome/ingest.ts), or explains precisely why
 * not — already in the bank, not an exam, unreadable, outside Blida 1
 * Médecine, metadata contradicting the header. A refused file is deleted.
 *
 * Body: { path, fileName, mimeType, unitCode?, academicYear?, session?,
 * sitting?, rotation?, variant?, examDate?, durationMinutes?, provenance?,
 * notes? } — what the header says fills whatever is not declared.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  const ctx = await genomeContext();
  if (ctx instanceof NextResponse) return ctx;

  const rl = rateLimit(`exam-genome-ingest:${ctx.user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Trop d'envois — réessaie dans quelques minutes." }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } });

  const body = await readJson(request);
  if (!body) return fail(400, "Corps de requête JSON invalide.");
  const { path, fileName, mimeType } = body;
  if (!isOwnGenomePath(ctx.user.id, path)) return fail(403, "Chemin de fichier invalide.");
  if (typeof fileName !== "string" || !fileName.trim()) return fail(400, "'fileName' est requis.");
  if (!isGenomeMimeType(mimeType)) return fail(400, "Format non supporté — envoie un PDF, ou une photo PNG ou JPG.");

  const declared: DeclaredMeta = {
    unitCode: text(body.unitCode, 40),
    academicYear: text(body.academicYear, 20),
    session: pick(body.session, GENOME_SESSIONS),
    sitting: pick(body.sitting, GENOME_SITTINGS),
    rotation: int(body.rotation),
    variant: text(body.variant, 12),
    examDate: text(body.examDate, 10),
    durationMinutes: int(body.durationMinutes),
    provenance: pick(body.provenance, GENOME_PROVENANCES),
    notes: text(body.notes, 2000),
  };

  try {
    const result = await ingestPaper({
      supabase: ctx.supabase,
      userId: ctx.user.id,
      isAdmin: ctx.isAdmin,
      storagePath: path,
      fileName,
      mimeType,
      declared,
      deadline: started + maxDuration * 1000 - DEADLINE_MARGIN_MS,
    });
    await recordContribution(ctx.supabase, {
      contributorId: ctx.user.id,
      isAdmin: ctx.isAdmin,
      declared,
      paperId: result.paperId,
      outcome: result.status === "duplicate" ? "duplicate" : "ingested",
      detail: result.warnings.slice(0, 5).join(" | ") || null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof GenomeUnavailableError) return genomeErrorResponse(error, "ingest");
    const refused = error instanceof GenomeIngestError;
    // A file that will never become a paper is not kept (an exact re-upload is the same bytes as the stored copy).
    if (!refused || error.outcome !== "rejected" || error.status !== 404) {
      const { error: removeError } = await ctx.supabase.storage.from(GENOME_BUCKET).remove([path]);
      if (removeError) console.warn("[exam-genome/ingest] Fichier refusé non supprimé :", removeError.message);
    }
    await recordContribution(ctx.supabase, {
      contributorId: ctx.user.id,
      isAdmin: ctx.isAdmin,
      declared,
      paperId: refused && typeof error.details.paperId === "string" ? error.details.paperId : null,
      outcome: refused ? error.outcome : "rejected",
      detail: error instanceof Error ? error.message : null,
    });
    return genomeErrorResponse(error, "ingest");
  }
}
