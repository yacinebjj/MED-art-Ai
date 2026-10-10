import { cookies, headers } from "next/headers";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, DEVICE_ID_RE } from "@/lib/device-cookie";

/**
 * DEVICE LIMIT — one account, at most MAX_DEVICES devices
 * (supabase/migrations/20261011_device_limit.sql).
 *
 * A device is a browser profile, identified by the httpOnly DEVICE_COOKIE
 * (random UUID, set by middleware.ts on the first page load). Every API route
 * goes through getAuthenticatedUser (lib/supabase/session-server.ts), which
 * calls checkDevice: a device beyond the limit gets 401 on every route, and
 * components/security/DeviceGuard.tsx shows it the "2 devices max" screen,
 * where the student can replace one of their devices (once per 24 h).
 *
 * Losing the cookie (cleared site data, another browser) makes a new device:
 * that is what lets the limit hold. Stripping the cookie on purpose does not
 * bypass anything — the request just becomes yet another new device.
 *
 * Fail-open on infrastructure: the migration not run yet, or the database
 * unreachable, never locks a student out — the limit is anti-sharing, not a
 * security boundary (auth itself is enforced separately).
 */
export const MAX_DEVICES = 2;
export const DEVICE_REPLACE_COOLDOWN_HOURS = 24;

export type DeviceStatus = "ok" | "limit";

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
  return `${os} · ${browser}`;
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

/** Registers this device if a slot is free; "limit" when the account already has MAX_DEVICES other devices. */
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
  const key = cacheKey(userId, deviceId);
  const cachedUntil = okCache.get(key);
  if (cachedUntil && cachedUntil > Date.now()) return "ok";

  const { data, error } = await getSupabaseAdmin().rpc("claim_user_device", {
    p_user_id: userId,
    p_device_id: deviceId,
    p_label: currentDeviceLabel(),
    p_max: MAX_DEVICES,
  });
  if (error) {
    if (!isMissingSchema(error)) console.error("[devices] claim_user_device failed (laissé passer):", error.message);
    return "ok";
  }
  if (data === "limit") return "limit";
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

export type ReplaceResult = "ok" | "cooldown" | "not_found" | "error";

/** Frees `oldDeviceId` and gives its slot to this device (rate-limited by DEVICE_REPLACE_COOLDOWN_HOURS). */
export async function replaceDevice(userId: string, oldDeviceId: string): Promise<ReplaceResult> {
  if (!isSupabaseConfigured()) return "error";
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

/** Sign-out: this device's slot becomes free again. */
export async function releaseCurrentDevice(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const deviceId = currentDeviceId();
  okCache.delete(cacheKey(userId, deviceId));
  const { error } = await getSupabaseAdmin().from("user_devices").delete().eq("user_id", userId).eq("device_id", deviceId);
  if (error && !isMissingSchema(error)) console.error("[devices] release failed:", error.message);
}
