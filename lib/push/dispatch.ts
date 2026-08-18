import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/server";

let vapidConfigured = false;

function ensureVapidConfigured(): void {
  if (vapidConfigured) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT ne sont pas configurées sur le serveur.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface StudioCourseFlashcardRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  flashcard_queue: { id: string; question: string; answer: string }[] | null;
}

/**
 * Sends one flashcard-reminder push to every device the given user has
 * subscribed from — picks one random card from a random active-module
 * course (same selection spirit as app/api/flashcards/pool, just one card
 * instead of the whole pool). Any subscription the push service reports as
 * permanently gone (404/410 — browser uninstalled, permission revoked) is
 * dropped from `profiles.push_subscriptions`; anything else (network blip,
 * 5xx) is left alone for the next attempt. Returns how many devices were
 * actually notified — 0 for every silent, non-error case (no active
 * modules, no queued cards yet, no subscriptions at all).
 */
export async function dispatchFlashcardPushToUser(userId: string): Promise<number> {
  ensureVapidConfigured();
  const supabase = getSupabaseAdmin();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("flashcard_active_module_ids, push_subscriptions")
    .eq("id", userId)
    .maybeSingle<{ flashcard_active_module_ids: number[] | null; push_subscriptions: PushSubscriptionRecord[] | null }>();

  if (profileError || !profile) return 0;

  const subscriptions = profile.push_subscriptions ?? [];
  const activeModuleIds = profile.flashcard_active_module_ids ?? [];
  if (subscriptions.length === 0 || activeModuleIds.length === 0) return 0;

  const { data: courses } = await supabase
    .from("studio_courses")
    .select("id, title, curriculum_module_id, flashcard_queue")
    .eq("user_id", userId)
    .in("curriculum_module_id", activeModuleIds);

  const rows = (courses ?? []) as StudioCourseFlashcardRow[];
  const coursesWithCards = rows.filter((row) => (row.flashcard_queue?.length ?? 0) > 0);
  if (coursesWithCards.length === 0) return 0;

  const course = coursesWithCards[Math.floor(Math.random() * coursesWithCards.length)];
  const queue = course.flashcard_queue!;
  const card = queue[Math.floor(Math.random() * queue.length)];

  const payload = JSON.stringify({
    title: "🧠 Rappel Flash - Médecine",
    body: card.question,
    url: `/study?tab=flashcards&cardId=${card.id}`,
  });

  const results = await Promise.allSettled(subscriptions.map((subscription) => webpush.sendNotification(subscription, payload)));

  let sentCount = 0;
  const stillValid: PushSubscriptionRecord[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      sentCount++;
      stillValid.push(subscriptions[i]);
      return;
    }
    const statusCode = (result.reason as { statusCode?: number } | undefined)?.statusCode;
    if (statusCode !== 404 && statusCode !== 410) {
      stillValid.push(subscriptions[i]);
    }
  });

  if (stillValid.length !== subscriptions.length) {
    await supabase.from("profiles").update({ push_subscriptions: stillValid }).eq("id", userId);
  }

  return sentCount;
}

/**
 * Global sweep — every user with at least one push subscription AND at
 * least one activated module gets a shot at dispatchFlashcardPushToUser.
 * Meant to be called by a real external trigger (Vercel Cron, GitHub
 * Actions, an uptime service) hitting app/api/push/dispatch, protected by
 * CRON_SECRET — see that route's own comment for why a client-side timer
 * alone can never substitute for this (Web Push's entire point is delivery
 * without an open browser tab).
 */
export async function dispatchFlashcardPushToAllUsers(): Promise<{ usersNotified: number; devicesNotified: number }> {
  ensureVapidConfigured();
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.from("profiles").select("id, flashcard_active_module_ids, push_subscriptions");

  if (error) throw new Error(error.message);

  const eligibleUserIds = (data ?? [])
    .filter(
      (row) =>
        ((row.push_subscriptions as unknown[] | null)?.length ?? 0) > 0 &&
        ((row.flashcard_active_module_ids as unknown[] | null)?.length ?? 0) > 0
    )
    .map((row) => row.id as string);

  const results = await Promise.allSettled(eligibleUserIds.map((userId) => dispatchFlashcardPushToUser(userId)));

  let usersNotified = 0;
  let devicesNotified = 0;
  for (const result of results) {
    if (result.status === "fulfilled" && result.value > 0) {
      usersNotified++;
      devicesNotified += result.value;
    }
  }

  return { usersNotified, devicesNotified };
}
