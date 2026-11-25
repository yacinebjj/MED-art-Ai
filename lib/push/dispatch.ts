import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isMissingColumnError } from "@/lib/group-chat";
import { normalizeFlashcardPushInterval } from "@/lib/push/cadence";
import { WRITE_CONFLICT, retryOnWriteConflict, updateIfUnchanged } from "@/lib/supabase/compare-and-set";

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

/** French label for a Studio section id, for push copy — a small local map rather than importing lib/demo-content (a client-oriented module with icon components this server-only file has no business pulling in). */
const STUDIO_SECTION_PUSH_LABELS: Record<string, string> = {
  explication: "L'Explication Ultra-Détaillée",
  resume: "Le Résumé",
  cas_clinique: "Le Cas Clinique",
  qcm: "Le QCM",
  exemples_analogies: "Les Exemples & Analogies",
};

interface StudioCourseFlashcardRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  flashcard_queue: { id: string; question: string; answer: string }[] | null;
}

interface FlashcardProfileRow {
  flashcard_active_module_ids: number[] | null;
  push_subscriptions: PushSubscriptionRecord[] | null;
  /** Absent until supabase/migrations/20261004_flashcard_push_cadence.sql has run. */
  flashcard_push_interval_minutes?: number | null;
  flashcard_push_last_sent_at?: string | null;
}

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Slack so a reminder sent at 10:00:05 is still due when the next hourly
 * cron fires at 11:00:01 (otherwise that run would skip and leave a 2 h gap).
 */
const CADENCE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Claims this student's next reminder slot — the single gate every trigger
 * (hourly cron, open-tab fallback on any device) goes through, so a student
 * gets exactly ONE flashcard push per interval no matter how many devices
 * are open. Compare-and-set on flashcard_push_last_sent_at: if two triggers
 * race, only one update matches. "untracked" = cadence columns not migrated
 * yet (the caller's own interval is then the only throttle).
 */
async function claimFlashcardSlot(supabase: SupabaseAdmin, userId: string, profile: FlashcardProfileRow, cadenceTracked: boolean): Promise<boolean | "untracked"> {
  if (!cadenceTracked) return "untracked";
  const intervalMs = normalizeFlashcardPushInterval(profile.flashcard_push_interval_minutes) * 60 * 1000;
  const last = profile.flashcard_push_last_sent_at ?? null;
  if (last) {
    const lastMs = new Date(last).getTime();
    if (Number.isFinite(lastMs) && Date.now() - lastMs < intervalMs - CADENCE_TOLERANCE_MS) return false;
  }
  const update = supabase.from("profiles").update({ flashcard_push_last_sent_at: new Date().toISOString() }).eq("id", userId);
  const { data, error } = await (last ? update.eq("flashcard_push_last_sent_at", last) : update.is("flashcard_push_last_sent_at", null)).select("id");
  if (error) return isMissingColumnError(error) ? "untracked" : false;
  return (data?.length ?? 0) > 0;
}

/**
 * Core of dispatchFlashcardPushToUser, factored out so the bulk sweep
 * (dispatchFlashcardPushToAllUsers) can pass in profile/course rows it
 * already fetched in ONE batched query across all eligible users, instead
 * of every user re-querying both tables individually — a real, confirmed
 * N+1 on the hourly cron path (2 extra unbatched round trips per eligible
 * user: a redundant profile re-fetch, and an unbatched studio_courses
 * query, on top of the bulk profiles query dispatchFlashcardPushToAllUsers
 * already does).
 */
async function sendFlashcardPushForProfile(
  userId: string,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  profile: FlashcardProfileRow,
  courses: StudioCourseFlashcardRow[]
): Promise<number> {
  const subscriptions = profile.push_subscriptions ?? [];
  const activeModuleIds = profile.flashcard_active_module_ids ?? [];
  if (subscriptions.length === 0 || activeModuleIds.length === 0) return 0;

  const coursesWithCards = courses.filter((row) => (row.flashcard_queue?.length ?? 0) > 0);
  if (coursesWithCards.length === 0) return 0;

  const course = coursesWithCards[Math.floor(Math.random() * coursesWithCards.length)];
  const queue = course.flashcard_queue!;
  const card = queue[Math.floor(Math.random() * queue.length)];

  const payload = JSON.stringify({
    title: "🧠 Rappel Flash - Médecine",
    body: card.question,
    url: `/dashboard/study?tab=flashcards&cardId=${encodeURIComponent(card.id)}`,
  });

  const results = await Promise.allSettled(subscriptions.map((subscription) => webpush.sendNotification(subscription, payload)));

  let sentCount = 0;
  const goneEndpoints = new Set<string>();
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      sentCount++;
      return;
    }
    const statusCode = (result.reason as { statusCode?: number } | undefined)?.statusCode;
    if (statusCode === 404 || statusCode === 410) goneEndpoints.add(subscriptions[i].endpoint);
  });

  await pruneGoneSubscriptions(supabase, userId, goneEndpoints);

  return sentCount;
}

/**
 * Drops the endpoints a push service reported permanently gone (404/410)
 * from the student's CURRENT subscription list, re-read now. Writing back
 * the list read before the pushes went out (as this used to) erased a device
 * that subscribed meanwhile, or brought back one that unsubscribed.
 * Compare-and-set (lib/supabase/compare-and-set.ts), retried on a concurrent
 * change. Fail-open, as before: a failed prune is retried at the next push.
 */
async function pruneGoneSubscriptions(supabase: SupabaseAdmin, userId: string, goneEndpoints: Set<string>): Promise<void> {
  if (goneEndpoints.size === 0) return;
  await retryOnWriteConflict(async () => {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("push_subscriptions")
      .eq("id", userId)
      .maybeSingle<{ push_subscriptions: PushSubscriptionRecord[] | null }>();
    if (error || !profile) return;
    const current = profile.push_subscriptions ?? [];
    const remaining = current.filter((subscription) => !goneEndpoints.has(subscription.endpoint));
    if (remaining.length === current.length) return;
    const written = await updateIfUnchanged(
      supabase.from("profiles").update({ push_subscriptions: remaining }).eq("id", userId),
      "push_subscriptions",
      profile.push_subscriptions,
      "jsonb",
      "id"
    );
    return written === WRITE_CONFLICT ? WRITE_CONFLICT : undefined;
  });
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
 *
 * Standalone entry point (app/api/push/dispatch-self/route.ts) — fetches
 * its own profile/course rows, unlike the bulk sweep below which already
 * has them in hand and calls sendFlashcardPushForProfile directly instead.
 */
export async function dispatchFlashcardPushToUser(userId: string): Promise<number> {
  ensureVapidConfigured();
  const supabase = getSupabaseAdmin();

  let cadenceTracked = true;
  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("flashcard_active_module_ids, push_subscriptions, flashcard_push_interval_minutes, flashcard_push_last_sent_at")
    .eq("id", userId)
    .maybeSingle<FlashcardProfileRow>();
  if (isMissingColumnError(profileError)) {
    cadenceTracked = false;
    ({ data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("flashcard_active_module_ids, push_subscriptions")
      .eq("id", userId)
      .maybeSingle<FlashcardProfileRow>());
  }

  if (profileError || !profile) return 0;

  const activeModuleIds = profile.flashcard_active_module_ids ?? [];
  if ((profile.push_subscriptions?.length ?? 0) === 0 || activeModuleIds.length === 0) return 0;

  // Exactly one reminder per interval, across all the student's devices and the cron.
  if ((await claimFlashcardSlot(supabase, userId, profile, cadenceTracked)) === false) return 0;

  const { data: courses } = await supabase
    .from("studio_courses")
    .select("id, title, curriculum_module_id, flashcard_queue")
    .eq("user_id", userId)
    .in("curriculum_module_id", activeModuleIds);

  return sendFlashcardPushForProfile(userId, supabase, profile, (courses ?? []) as StudioCourseFlashcardRow[]);
}

/**
 * Point 6 ("content is ready" notification) — real Web Push, not the
 * browser's page-scoped Notification API: a plain `new Notification(...)`
 * only fires while the exact tab that requested permission is still open on
 * the right page, which defeats the entire point for a student who
 * navigated away or closed the tab while a real generation (Explication/QCM
 * can run into the minutes) kept working server-side. Reuses the SAME VAPID/
 * webpush/push_subscriptions infrastructure dispatchFlashcardPushToUser
 * above already relies on. Fire-and-forget from the caller (never awaited
 * inline with the generation response) and fail-open by design — a push
 * failure must never turn an otherwise-successful generation into an error.
 */
export async function dispatchStudioGenerationPush(userId: string, courseTitle: string, sectionId: string, url: string): Promise<void> {
  const sectionLabel = STUDIO_SECTION_PUSH_LABELS[sectionId] ?? "Le contenu";
  await dispatchPushToUser(userId, { title: "✅ MedArt AI", body: `${sectionLabel} de "${courseTitle}" est prêt.`, url });
}

/**
 * One push notification to every registered device of one user (e.g. a
 * group-chat @mention). Fail-open: no VAPID config, no subscription or a
 * delivery error never throws — a notification must never break the action
 * that triggered it. Expired subscriptions (404/410) are pruned.
 */
export async function dispatchPushToUser(userId: string, message: { title: string; body: string; url: string }): Promise<void> {
  try {
    ensureVapidConfigured();
  } catch (error) {
    console.warn("[push] VAPID non configuré — notification ignorée:", error instanceof Error ? error.message : error);
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("push_subscriptions")
    .eq("id", userId)
    .maybeSingle<{ push_subscriptions: PushSubscriptionRecord[] | null }>();

  if (error || !profile) return;
  const subscriptions = profile.push_subscriptions ?? [];
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify(message);

  const results = await Promise.allSettled(subscriptions.map((subscription) => webpush.sendNotification(subscription, payload)));

  const goneEndpoints = new Set<string>();
  results.forEach((result, i) => {
    if (result.status === "fulfilled") return;
    const statusCode = (result.reason as { statusCode?: number } | undefined)?.statusCode;
    if (statusCode === 404 || statusCode === 410) goneEndpoints.add(subscriptions[i].endpoint);
  });

  await pruneGoneSubscriptions(supabase, userId, goneEndpoints);
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
  const deadline = Date.now() + SWEEP_TIME_BUDGET_MS;

  let cadenceTracked = true;
  let usersNotified = 0;
  let devicesNotified = 0;
  let afterId: string | null = null;

  // Page by page (PostgREST returns at most 1000 rows per request: one read
  // of every profile silently left out everyone past the first 1000), only
  // the students who can get a reminder at all — a subscription and an
  // active module, filtered in SQL as well as below.
  for (;;) {
    if (Date.now() >= deadline) {
      console.warn("[push/sweep] Budget de temps atteint — les élèves restants seront traités au prochain passage.");
      break;
    }
    let { data, error } = await readSweepPage(supabase, cadenceTracked, afterId);
    if (cadenceTracked && isMissingColumnError(error)) {
      cadenceTracked = false;
      ({ data, error } = await readSweepPage(supabase, cadenceTracked, afterId));
    }
    if (error) throw new Error(error.message);
    const page = data ?? [];

    const eligibleProfiles = page.filter(
      (row) =>
        ((row.push_subscriptions as unknown[] | null)?.length ?? 0) > 0 &&
        ((row.flashcard_active_module_ids as unknown[] | null)?.length ?? 0) > 0
    );

    // PERFORMANCE: was one unbatched studio_courses query (plus a fully
    // redundant re-fetch of the SAME profile row already in hand above) PER
    // eligible user — a real, confirmed N+1 on this hourly sweep. Still
    // batched, but SWEEP_COURSE_QUERY_USERS students per query: every
    // eligible id in one `in.(…)` filter outgrew the request URL, and the
    // failed query (its error was ignored) claimed everyone's slot with no
    // course to send. Each student's own flashcard_active_module_ids only
    // makes sense scoped to their own courses, so the module-id filter stays
    // in memory.
    for (let start = 0; start < eligibleProfiles.length && Date.now() < deadline; start += SWEEP_COURSE_QUERY_USERS) {
      const group = eligibleProfiles.slice(start, start + SWEEP_COURSE_QUERY_USERS);
      const coursesByUser = await readFlashcardCoursesByUser(supabase, group.map((profile) => profile.id));
      if (!coursesByUser) continue; // logged; these students keep their slot for the next run

      await runWithConcurrency(group, SWEEP_CONCURRENCY, deadline, async (profile) => {
        try {
          const activeModuleIds = new Set(profile.flashcard_active_module_ids ?? []);
          const userCourses = (coursesByUser.get(profile.id) ?? []).filter((c) => activeModuleIds.has(c.curriculum_module_id));
          const claimed = await claimFlashcardSlot(supabase, profile.id, profile, cadenceTracked);
          if (claimed === false) return;
          const sent = await sendFlashcardPushForProfile(profile.id, supabase, profile, userCourses);
          if (sent > 0) {
            usersNotified++;
            devicesNotified += sent;
          }
        } catch (sweepError) {
          console.error("[push/sweep] Élève ignoré après une erreur:", sweepError);
        }
      });
    }

    if (page.length < SWEEP_PAGE_SIZE) break;
    afterId = page[page.length - 1].id;
  }

  return { usersNotified, devicesNotified };
}

/** Students read per page of the sweep (PostgREST caps a response at 1000 rows). */
const SWEEP_PAGE_SIZE = 500;
/** Students whose courses one studio_courses query fetches (their ids travel in the URL). */
const SWEEP_COURSE_QUERY_USERS = 50;
/** Courses per studio_courses page. */
const SWEEP_COURSE_PAGE_SIZE = 500;
/** Students handled at once — each is a claim UPDATE, then one push per device. */
const SWEEP_CONCURRENCY = 10;
/**
 * No new student is started past this point — app/api/push/dispatch allows
 * 60 s. Students not reached keep their slot and are picked up next run.
 */
const SWEEP_TIME_BUDGET_MS = 45_000;

type SweepProfileRow = FlashcardProfileRow & { id: string };

/** One page of the sweep's students, by id, after `afterId` (null: from the start). */
async function readSweepPage(
  supabase: SupabaseAdmin,
  cadenceTracked: boolean,
  afterId: string | null
): Promise<{ data: SweepProfileRow[] | null; error: { message: string; code?: string } | null }> {
  const columns = cadenceTracked
    ? "id, flashcard_active_module_ids, push_subscriptions, flashcard_push_interval_minutes, flashcard_push_last_sent_at"
    : "id, flashcard_active_module_ids, push_subscriptions";
  let query = supabase
    .from("profiles")
    .select(columns)
    .neq("push_subscriptions", "[]")
    .neq("flashcard_active_module_ids", "{}")
    .order("id", { ascending: true })
    .limit(SWEEP_PAGE_SIZE);
  if (afterId) query = query.gt("id", afterId);
  const { data, error } = await query;
  return { data: (data ?? null) as SweepProfileRow[] | null, error };
}

/**
 * The courses holding flashcards of these students, grouped by student —
 * every page of them. Null when a query fails: the caller then skips these
 * students without claiming their slot.
 */
async function readFlashcardCoursesByUser(supabase: SupabaseAdmin, userIds: string[]): Promise<Map<string, StudioCourseFlashcardRow[]> | null> {
  const coursesByUser = new Map<string, StudioCourseFlashcardRow[]>();
  let afterCourseId: number | null = null;
  for (;;) {
    let query = supabase
      .from("studio_courses")
      .select("id, title, curriculum_module_id, flashcard_queue, user_id")
      .in("user_id", userIds)
      .neq("flashcard_queue", "[]")
      .order("id", { ascending: true })
      .limit(SWEEP_COURSE_PAGE_SIZE);
    if (afterCourseId !== null) query = query.gt("id", afterCourseId);
    const { data, error } = await query;
    if (error) {
      console.error("[push/sweep] Lecture des cours échouée — élèves reportés au prochain passage:", error.message);
      return null;
    }
    const rows = (data ?? []) as (StudioCourseFlashcardRow & { user_id: string })[];
    for (const row of rows) {
      const list = coursesByUser.get(row.user_id);
      if (list) list.push(row);
      else coursesByUser.set(row.user_id, [row]);
    }
    if (rows.length < SWEEP_COURSE_PAGE_SIZE) return coursesByUser;
    afterCourseId = rows[rows.length - 1].id;
  }
}

/** Runs `worker` over `items`, `limit` at a time, starting none past `deadline`. `worker` must not throw. */
async function runWithConcurrency<T>(items: T[], limit: number, deadline: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length && Date.now() < deadline) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
