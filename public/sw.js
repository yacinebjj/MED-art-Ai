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
  const url = payload.url || "/study?tab=flashcards";

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
 * Deep-links back into /study on the "Flashcards" tab, focusing an
 * already-open tab instead of always spawning a new one when one already
 * exists for this app.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/study?tab=flashcards";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("navigate" in client && "focus" in client) {
          return client.navigate(targetUrl).then((navigated) => navigated && navigated.focus());
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
