import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { EXPIRED_COOKIE, isSessionCookieName } from "@/lib/supabase/dead-session";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { cleanUpAfterDeletion, collectPersonalFiles, deletionBlocker, handOverAdministeredGroups } from "@/lib/account-deletion";

export const runtime = "nodejs";
// The deletion itself is quick; the file clean-up after it gets up to 25 s.
export const maxDuration = 60;

/** The word the student types to confirm (the settings dialog asks for it in their language). */
const CONFIRMATION_WORDS = new Set(["SUPPRIMER", "DELETE"]);

/**
 * POST /api/account/delete — body `{ confirmation: "SUPPRIMER" }` (or
 * "DELETE"). Deletes the signed-in student's account and its data, for
 * good: see lib/account-deletion.ts for what goes, what stays and in which
 * order. Answers:
 *  - 200 `{ success: true }` — the account is gone and this browser's session
 *    cookies are cleared;
 *  - 409 `{ code, error }` — refused for now (money in flight); nothing changed;
 *  - 400 (confirmation missing), 401, 429, 500.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`account-delete:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const body = (await request.json().catch(() => null)) as { confirmation?: unknown } | null;
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation.trim().toUpperCase() : "";
  if (!CONFIRMATION_WORDS.has(confirmation)) {
    return NextResponse.json({ success: false, error: "Confirmation manquante : tape SUPPRIMER pour confirmer." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }
  const supabase = getSupabaseAdmin();

  const blocker = await deletionBlocker(supabase, user.id);
  if (blocker) {
    return NextResponse.json({ success: false, code: blocker.code, error: blocker.message }, { status: blocker.code === "check_failed" ? 503 : 409 });
  }

  if (!(await handOverAdministeredGroups(supabase, user.id))) {
    console.error(`[account/delete] Groupes de ${user.id} non transmis — suppression annulée.`);
    return NextResponse.json({ success: false, error: "La suppression a échoué. Réessaie dans un instant." }, { status: 500 });
  }

  const personalFiles = await collectPersonalFiles(supabase, user.id);

  // The cascade: every row linked to the account by a foreign key goes with it.
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  // 404: a parallel request already deleted it — finish the clean-up all the same.
  if (error && error.status !== 404) {
    console.error(`[account/delete] auth.admin.deleteUser(${user.id}) a échoué:`, error.message);
    return NextResponse.json({ success: false, error: "La suppression a échoué. Réessaie dans un instant." }, { status: 500 });
  }
  console.log(`[account/delete] Compte ${user.id} supprimé.`);

  await cleanUpAfterDeletion(supabase, user.id, personalFiles);

  // This browser stops presenting a session that no longer exists.
  const cookieStore = cookies();
  for (const { name } of cookieStore.getAll()) {
    if (isSessionCookieName(name)) cookieStore.set(name, "", EXPIRED_COOKIE);
  }
  return NextResponse.json({ success: true });
}
