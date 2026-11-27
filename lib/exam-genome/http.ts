import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { isBillingAdmin } from "@/lib/billing-pools";
import { GenomeUnavailableError } from "@/lib/exam-genome/db";
import { GenomeIngestError } from "@/lib/exam-genome/errors";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";

/** Shared guards of the app/api/exam-genome routes. */

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

export type GenomeContext = { user: User; isAdmin: boolean; supabase: ReturnType<typeof getSupabaseAdmin> };

/** The signed-in caller and the service-role client — or the response to send instead. */
export async function genomeContext(options: { adminOnly?: boolean } = {}): Promise<GenomeContext | NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return fail(401, "Tu dois être connecté(e).");
  const isAdmin = isBillingAdmin(user);
  if (options.adminOnly && !isAdmin) return fail(403, "Réservé à l'équipe MedArt.");
  if (!isSupabaseConfigured()) return fail(500, "Supabase n'est pas configuré sur le serveur.");
  return { user, isAdmin, supabase: getSupabaseAdmin() };
}

export function genomeErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof GenomeUnavailableError) return fail(503, error.message);
  if (error instanceof GenomeIngestError) return fail(error.status, error.message, { outcome: error.outcome, ...error.details });
  console.error(`[exam-genome/${context}]`, error);
  return fail(500, "Erreur inattendue de la banque d'examens.");
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
