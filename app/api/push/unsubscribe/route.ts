import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { WRITE_CONFLICT, WRITE_CONFLICT_MESSAGE, retryOnWriteConflict, updateIfUnchanged } from "@/lib/supabase/compare-and-set";

export const runtime = "nodejs";

interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Removes one endpoint from `profiles.push_subscriptions` — called after the browser's own subscription.unsubscribe() succeeds (lib/push/subscribe.ts), and also self-healed automatically by lib/push/dispatch.ts whenever a push service confirms an endpoint is permanently gone (404/410). */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { endpoint } = (body ?? {}) as { endpoint?: unknown };
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ success: false, error: "'endpoint' est requis." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Compare-and-set (lib/supabase/compare-and-set.ts): another device
  // subscribing at the same moment must not lose its entry to this removal.
  const outcome = await retryOnWriteConflict(async () => {
    const { data: profile, error: readError } = await supabase
      .from("profiles")
      .select("push_subscriptions")
      .eq("id", user.id)
      .maybeSingle<{ push_subscriptions: PushSubscriptionRecord[] | null }>();

    if (readError) {
      return NextResponse.json({ success: false, error: `Lecture échouée : ${readError.message}` }, { status: 500 });
    }

    const current = profile?.push_subscriptions ?? [];
    const nextSubscriptions = current.filter((sub) => sub.endpoint !== endpoint);

    const written = await updateIfUnchanged(
      supabase.from("profiles").update({ push_subscriptions: nextSubscriptions }).eq("id", user.id),
      "push_subscriptions",
      profile?.push_subscriptions,
      "jsonb",
      "id"
    );
    if (written === WRITE_CONFLICT) return WRITE_CONFLICT;

    if (written.error) {
      return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${written.error.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  });

  if (outcome === WRITE_CONFLICT) {
    return NextResponse.json({ success: false, error: WRITE_CONFLICT_MESSAGE }, { status: 409 });
  }
  return outcome;
}
