import { cookies, headers } from "next/headers";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, DEVICE_ID_RE } from "@/lib/device-cookie";
import { detectInAppBrowser, type InAppBrowser } from "@/lib/in-app-browser";

/**
 * DEVICE LIMIT — one account, at most MAX_DEVICES devices
 * (supabase/migrations/20261011_device_limit.sql; the limit and the cooldown
 * are passed to its SQL functions from here), in-app browsers apart (see
 * MAX_IN_APP_DEVICES).
 *
 * A device is a browser profile, identified by the httpOnly DEVICE_COOKIE
 * (random UUID, set by middleware.ts on the first page load). Every API route
 * goes through getAuthenticatedUser (lib/supabase/session-server.ts), which
 * calls checkDevice: a device beyond the limit gets 401 on every route, and
 * components/security/DeviceGuard.tsx shows it the device-limit screen,
 * where the student can replace one of their devices (once per
 * DEVICE_REPLACE_COOLDOWN_HOURS).
 *
 * Losing the cookie (cleared site data, another browser) makes a new device:
 * that is what lets the limit hold. Stripping the cookie on purpose does not
 * bypass anything — the request just becomes yet another new device.
 *
 * Fail-open on infrastructure: the migration not run yet, or the database
 * unreachable, never locks a student out — the limit is anti-sharing, not a
 * security boundary (auth itself is enforced separately).
 */
export const MAX_DEVICES = 3;
export const DEVICE_REPLACE_COOLDOWN_HOURS = 6;

/**
 * A device unseen for this long no longer holds a slot. A registered device
 * refreshes last_seen_at at least once a minute while in use (claim_user_device,
 * okCache), so only browsers that are really gone — cleared site data, a
 * private window, a reinstalled or sold phone — get this old. They used to
 * keep their slot forever: students ended on the device-limit screen and,
 * with two of them to replace, waited out DEVICE_REPLACE_COOLDOWN_HOURS.
 */
const STALE_DEVICE_DAYS = 14;

/**
 * In-app browsers — MedArt opened from a link inside Instagram, Facebook,
 * Messenger, TikTok… — keep their own cookies, so each one used to take a
 * device slot: a student with a phone and a laptop who tapped one link in
 * Instagram was "on a third device", and replacing their laptop to get in
 * locked the laptop out for a day.
 *
 * They are NOT counted against MAX_DEVICES any more. They live in a list of
 * their own (same table, owner "inapp:<user id>" — no schema change), which
 * stays bounded so it cannot become a sharing loophole: at most
 * MAX_IN_APP_DEVICES in-app browsers used within IN_APP_WINDOW_DAYS; one
 * unused for that long drops out by itself. Only phones and tablets qualify,
 * and a desktop browser dressed up as Instagram (a user-agent switcher) is
 * caught by the platform Chromium still announces in its client hints.
 */
export const MAX_IN_APP_DEVICES = 2;
const IN_APP_WINDOW_DAYS = 7;
const inAppOwner = (userId: string) => `inapp:${userId}`;

export type DeviceStatus = "ok" | "limit" | "in_app_limit";

/** This request comes from an app's in-app browser on a phone or tablet (see MAX_IN_APP_DEVICES). */
export function inAppBrowserOfRequest(): InAppBrowser | null {
  const h = headers();
  const inApp = detectInAppBrowser(h.get("user-agent") ?? "");
  if (!inApp || !(inApp.android || inApp.ios)) return null;
  if (h.get("sec-ch-ua-mobile") === "?0") return null;
  const platform = (h.get("sec-ch-ua-platform") ?? "").replace(/"/g, "").trim().toLowerCase();
  if (platform && platform !== "android" && platform !== "ios") return null;
  return inApp;
}

/** This request's device id from its cookie, or null when the request carries none. */
function cookieDeviceId(): string | null {
  const existing = cookies().get(DEVICE_COOKIE)?.value;
  return existing && DEVICE_ID_RE.test(existing) ? existing : null;
}

/** This request's device id — from the cookie, or freshly minted (and set on the response when the context allows it). */
export function currentDeviceId(): string {
  const store = cookies();
  const existing = cookieDeviceId();
  if (existing) return existing;
  const minted = crypto.randomUUID();
  try {
    store.set(DEVICE_COOKIE, minted, DEVICE_COOKIE_OPTIONS);
  } catch {
    // Server Component context (read-only cookies): the next route handler call sets it.
  }
  return minted;
}

/** Short human label ("iPhone · Safari", "Windows · Chrome") so the student recognizes their devices. */
export function currentDeviceLabel(): string {
  const ua = headers().get("user-agent") ?? "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Appareil";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome|CriOS/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : "Navigateur";
  const inApp = inAppBrowserOfRequest();
  return inApp ? `${os} · ${inApp.app ?? "navigateur intégré"}` : `${os} · ${browser}`;
}

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ["42P01", "PGRST202", "PGRST205", "42883"].includes(error.code ?? "") || /does not exist|could not find/i.test(error.message ?? "");
}

// Per-instance cache of "this device is registered": a warm instance checks
// the database at most once a minute per device. A replaced device is
// therefore cut off within that minute.
const CHECK_TTL_MS = 60_000;
const okCache = new Map<string, number>();

function cacheKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

/**
 * Registers this device if a slot is free; "limit" when the account already has MAX_DEVICES other
 * devices, "in_app_limit" when this in-app browser is one too many (see MAX_IN_APP_DEVICES).
 */
export async function checkDevice(userId: string): Promise<DeviceStatus> {
  if (!isSupabaseConfigured()) return "ok";
  // No cookie yet (a tab opened before this feature shipped — middleware.ts
  // sets it on every page load, so real navigations always carry one): mint
  // and set it, but do not claim a slot with it. The app's parallel startup
  // calls would each mint a DIFFERENT id and fill both slots at once; only
  // the id the browser keeps comes back on later requests and gets claimed.
  if (!cookieDeviceId()) {
    currentDeviceId();
    return "ok";
  }
  const deviceId = currentDeviceId();
  const inApp = inAppBrowserOfRequest() !== null;
  const owner = inApp ? inAppOwner(userId) : userId;
  const key = cacheKey(owner, deviceId);
  const cachedUntil = okCache.get(key);
  if (cachedUntil && cachedUntil > Date.now()) return "ok";

  const admin = getSupabaseAdmin();
  if (inApp) {
    // Gives back the real slot this in-app browser may still hold from before it had its own
    // list, and forgets in-app browsers unused for IN_APP_WINDOW_DAYS. Best effort.
    const since = new Date(Date.now() - IN_APP_WINDOW_DAYS * 86_400_000).toISOString();
    await Promise.all([
      admin.from("user_devices").delete().eq("user_id", userId).eq("device_id", deviceId),
      admin.from("user_devices").delete().eq("user_id", owner).lt("last_seen_at", since),
    ]).catch(() => undefined);
  }
  const claim = () =>
    admin.rpc("claim_user_device", {
      p_user_id: owner,
      p_device_id: deviceId,
      p_label: currentDeviceLabel(),
      p_max: inApp ? MAX_IN_APP_DEVICES : MAX_DEVICES,
    });
  let { data, error } = await claim();
  if (!error && data === "limit" && !inApp) {
    // Full: give back the slots of devices unseen for STALE_DEVICE_DAYS, then
    // claim once more (always, even when this request deleted nothing — a
    // parallel request of this same device may just have freed the slot and
    // taken it). Best effort: a failed cleanup leaves "limit" as it was.
    const staleBefore = new Date(Date.now() - STALE_DEVICE_DAYS * 86_400_000).toISOString();
    const { error: evictError } = await admin.from("user_devices").delete().eq("user_id", owner).lt("last_seen_at", staleBefore);
    if (!evictError) ({ data, error } = await claim());
  }
  if (error) {
    if (!isMissingSchema(error)) console.error("[devices] claim_user_device failed (laissé passer):", error.message);
    return "ok";
  }
  if (data === "limit") return inApp ? "in_app_limit" : "limit";
  if (okCache.size > 5000) okCache.clear();
  okCache.set(key, Date.now() + CHECK_TTL_MS);
  return "ok";
}

export interface DeviceRow {
  id: string;
  label: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export async function listDevices(userId: string): Promise<DeviceRow[]> {
  if (!isSupabaseConfigured()) return [];
  const deviceId = currentDeviceId();
  const { data, error } = await getSupabaseAdmin()
    .from("user_devices")
    .select("device_id, label, created_at, last_seen_at")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });
  if (error) {
    if (!isMissingSchema(error)) console.error("[devices] list failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.device_id as string,
    label: (row.label as string | null) ?? null,
    createdAt: row.created_at as string,
    lastSeenAt: row.last_seen_at as string,
    current: row.device_id === deviceId,
  }));
}

export type ReplaceResult = "ok" | "cooldown" | "not_found" | "in_app" | "error";

/** Frees `oldDeviceId` and gives its slot to this device (rate-limited by DEVICE_REPLACE_COOLDOWN_HOURS). */
export async function replaceDevice(userId: string, oldDeviceId: string): Promise<ReplaceResult> {
  if (!isSupabaseConfigured()) return "error";
  // An in-app browser never takes a real slot: it can't push one of the student's devices out.
  if (inAppBrowserOfRequest()) return "in_app";
  const deviceId = currentDeviceId();
  const { data, error } = await getSupabaseAdmin().rpc("replace_user_device", {
    p_user_id: userId,
    p_old_device_id: oldDeviceId,
    p_new_device_id: deviceId,
    p_label: currentDeviceLabel(),
    p_cooldown_hours: DEVICE_REPLACE_COOLDOWN_HOURS,
  });
  if (error) {
    console.error("[devices] replace_user_device failed:", error.message);
    return "error";
  }
  okCache.delete(cacheKey(userId, oldDeviceId));
  if (data === "ok") okCache.set(cacheKey(userId, deviceId), Date.now() + CHECK_TTL_MS);
  return data === "ok" || data === "cooldown" || data === "not_found" ? data : "error";
}

/** Sign-out: this device's slot (or its in-app browser entry) becomes free again. */
export async function releaseCurrentDevice(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const deviceId = currentDeviceId();
  okCache.delete(cacheKey(userId, deviceId));
  okCache.delete(cacheKey(inAppOwner(userId), deviceId));
  const { error } = await getSupabaseAdmin().from("user_devices").delete().in("user_id", [userId, inAppOwner(userId)]).eq("device_id", deviceId);
  if (error && !isMissingSchema(error)) console.error("[devices] release failed:", error.message);
}
