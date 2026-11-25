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

function isValidSubscription(value: unknown): value is PushSubscriptionRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.endpoint !== "string" || !candidate.endpoint) return false;
  const keys = candidate.keys as Record<string, unknown> | undefined;
  return typeof keys?.p256dh === "string" && typeof keys?.auth === "string";
}

/** Saves the browser's PushSubscription (from lib/push/subscribe.ts) onto `profiles.push_subscriptions` — appends, deduped by endpoint (the same browser re-subscribing, e.g. after clearing site data, just replaces its old entry). */
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

  if (!isValidSubscription(body)) {
    return NextResponse.json({ success: false, error: "Objet PushSubscription invalide (endpoint/keys.p256dh/keys.auth requis)." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const subscription = body;

  // Compare-and-set (lib/supabase/compare-and-set.ts): a reminder sweep pruning
  // dead endpoints, or another device subscribing at the same moment, used to
  // erase this new subscription by writing back the list it had read.
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
    const withoutDuplicate = current.filter((sub) => sub.endpoint !== subscription.endpoint);
    const nextSubscriptions = [...withoutDuplicate, subscription];

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
