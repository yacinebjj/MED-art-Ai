/**
 * Web Push service worker — plain JS, served statically from /public at
 * the origin root (/sw.js), which is required: a service worker's scope is
 * limited to the directory it's served from, and Push needs to control the
 * whole app, not just one route. Registered by lib/push/subscribe.ts.
 *
 * Deliberately does NOT use next-pwa or any bundler — this is the entire
 * push feature's client-side runtime, small enough that a plain file is
 * simpler and more auditable than a build-tool-generated one.
 */

/**
 * Deliberately a no-op passthrough — NOT calling event.respondWith() means
 * every request is handled exactly as if no service worker existed at all
 * (normal network fetch, normal HTTP cache, nothing intercepted). This
 * exists ONLY so browsers that check for "a service worker with a fetch
 * handler" as a PWA-installability signal see one — this app deploys
 * frequently, so a real cache-first/offline strategy here would risk
 * trapping students on stale, already-fixed JS bundles. If real offline
 * support is ever wanted, build it deliberately (versioned cache name,
 * explicit invalidation on deploy) rather than bolting it onto this.
 */
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {};
  }

  const title = payload.title || "🧠 Rappel Flash - Médecine";
  const body = payload.body || "Une nouvelle flashcard t'attend.";
  const url = payload.url || "/dashboard/study?tab=flashcards";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "medart-flashcard-reminder",
      renotify: true,
      data: { url },
    })
  );
});

/**
 * Deep-links to the exact flashcard on the Flashcards tab, reusing an open
 * app tab when there is one. client.navigate() only works on tabs this
 * worker CONTROLS (it rejects on the "includeUncontrolled" ones — a click
 * then used to do nothing), so: navigate when possible, otherwise ask the
 * page itself to go there (PushClientFallbackProvider listens), otherwise
 * open a new window. Every step is guarded — a click always lands somewhere.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || "/dashboard/study?tab=flashcards";
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const appClient = clientList.find((client) => client.url.startsWith(self.location.origin));
      if (appClient) {
        try {
          if ("focus" in appClient) await appClient.focus();
        } catch (error) {
          // Focus can be refused (no user activation on some platforms) — keep going.
        }
        try {
          if ("navigate" in appClient) {
            const navigated = await appClient.navigate(targetUrl);
            if (navigated) return;
          }
        } catch (error) {
          // Uncontrolled tab: fall through to the message.
        }
        appClient.postMessage({ type: "medart:navigate", url: targetUrl });
        return;
      }
      if (clients.openWindow) await clients.openWindow(targetUrl);
    })()
  );
});
