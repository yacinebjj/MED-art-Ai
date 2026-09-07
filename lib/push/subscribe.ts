"use client";

/**
 * Client-side Web Push subscription flow — registers public/sw.js, requests
 * notification permission, and subscribes via the Push API using the VAPID
 * public key. Deliberately never called automatically: permission is only
 * ever requested from an explicit user click (subscribeToPush()), never on
 * page load — auto-prompting is both worse UX and risks a permanent
 * "denied" the browser won't ask about again.
 */

export type PushSupportStatus = "unsupported" | "denied" | "subscribed" | "not-subscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getPushStatus(): Promise<PushSupportStatus> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.getRegistration("/sw.js").catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  return subscription ? "subscribed" : "not-subscribed";
}

export async function subscribeToPush(): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: "Les notifications push ne sont pas supportées par ce navigateur." };
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return { success: false, error: "NEXT_PUBLIC_VAPID_PUBLIC_KEY n'est pas configurée." };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { success: false, error: "Permission refusée." };
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) {
      return { success: false, error: body?.error ?? "Échec de l'enregistrement côté serveur." };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erreur inconnue." };
  }
}

export async function unsubscribeFromPush(): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) return { success: true };

  try {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return { success: true };

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    const res = await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) {
      return { success: false, error: body?.error ?? "Échec de la désinscription côté serveur." };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erreur inconnue." };
  }
}
