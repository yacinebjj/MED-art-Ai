import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/session-server";
import { checkDevice, DEVICE_REPLACE_COOLDOWN_HOURS, listDevices, MAX_DEVICES, MAX_IN_APP_DEVICES, releaseCurrentDevice, replaceDevice } from "@/lib/devices";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Device limit (lib/devices.ts). Deliberately authenticated with
 * getSessionUser — NOT getAuthenticatedUser — because a device over the
 * limit must still be able to see its status and replace a device.
 *
 * GET  → { status: "ok" | "limit", reason?: "in_app", max, inAppMax, cooldownHours, devices }
 *        (reason "in_app": this in-app browser is one too many — it can't replace a device,
 *        the student is sent to their usual browser)
 * POST { action: "replace", deviceId } → gives that device's slot to this one
 * POST { action: "release" }            → sign-out: frees this device's slot
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  const status = await checkDevice(user.id);
  const devices = status === "in_app_limit" ? [] : await listDevices(user.id);
  return NextResponse.json(
    {
      status: status === "ok" ? "ok" : "limit",
      ...(status === "in_app_limit" ? { reason: "in_app" } : {}),
      max: MAX_DEVICES,
      inAppMax: MAX_IN_APP_DEVICES,
      cooldownHours: DEVICE_REPLACE_COOLDOWN_HOURS,
      devices,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });

  const rl = rateLimit(`devices:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown; deviceId?: unknown } | null;

  if (body?.action === "release") {
    await releaseCurrentDevice(user.id);
    return NextResponse.json({ success: true });
  }

  if (body?.action === "replace" && typeof body.deviceId === "string" && body.deviceId.length <= 64) {
    const result = await replaceDevice(user.id, body.deviceId);
    if (result === "ok") return NextResponse.json({ success: true });
    if (result === "cooldown") {
      return NextResponse.json(
        { success: false, error: `Tu as déjà remplacé un appareil ces dernières ${DEVICE_REPLACE_COOLDOWN_HOURS} h. Réessaie plus tard, ou déconnecte-toi depuis l'un de tes appareils.` },
        { status: 429 }
      );
    }
    if (result === "not_found") return NextResponse.json({ success: false, error: "Cet appareil n'est plus enregistré — actualise la page." }, { status: 404 });
    if (result === "in_app") {
      return NextResponse.json(
        { success: false, error: "Depuis le navigateur d'une application, tu ne peux pas remplacer un appareil : ouvre MedArt AI dans ton navigateur habituel." },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: false, error: "Impossible de remplacer l'appareil pour le moment. Réessaie dans un instant." }, { status: 500 });
  }

  return NextResponse.json({ error: "Action invalide." }, { status: 400 });
}
