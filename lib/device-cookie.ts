/** Edge-safe (no server-only imports): shared by middleware.ts and lib/devices.ts. */
export const DEVICE_COOKIE = "medart_device";
export const DEVICE_ID_RE = /^[0-9a-f-]{36}$/i;

export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 400 * 24 * 60 * 60, // browsers cap cookies at 400 days
};
