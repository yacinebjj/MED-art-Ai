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
 * Static-asset cache — the ONLY thing this worker ever answers itself.
 *
 * Never cached (left to the network exactly as if no worker existed):
 * HTML documents, RSC payloads, /api/**, any non-GET, any cross-origin
 * request (Supabase, Google), range requests (media). This app deploys
 * frequently, so a cached document or RSC payload could trap students on a
 * stale, already-fixed build — the reason this worker used to cache nothing.
 *
 * Cached:
 *  - /_next/static/** — content-hashed file names, immutable by
 *    construction: a deploy ships NEW URLs, so cache-first can never serve
 *    stale code. This is what makes a relaunch of the iOS home-screen app
 *    load its JavaScript/CSS/fonts from the device instead of the network.
 *  - /icons/**, /images/**, /logo.png — stable URLs, so stale-while-
 *    revalidate: instant from cache, refreshed in the background.
 *
 * Bump CACHE_VERSION to drop every cached file on the next activation.
 */
const CACHE_VERSION = "v1";
const STATIC_CACHE = `medart-static-${CACHE_VERSION}`;
const ASSET_CACHE = `medart-assets-${CACHE_VERSION}`;
const KNOWN_CACHES = [STATIC_CACHE, ASSET_CACHE];
/** Old builds' hashed chunks accumulate across deploys — keep the newest entries only. */
const MAX_STATIC_ENTRIES = 600;
const MAX_ASSET_ENTRIES = 120;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("medart-") && !KNOWN_CACHES.includes(name)).map((name) => caches.delete(name)));
      await Promise.all([trimCache(STATIC_CACHE, MAX_STATIC_ENTRIES), trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES)]);
      await self.clients.claim();
    })()
  );
});

async function trimCache(name, maxEntries) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    // keys() is in insertion order: the oldest entries go first.
    for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
  } catch (error) {
    // Cache Storage unavailable (private mode, quota) — nothing to trim.
  }
}

function isCacheableResponse(response) {
  return response && response.ok && response.status === 200 && response.type === "basic";
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (isCacheableResponse(response)) cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  if (cached) {
    event.waitUntil(network.then(() => undefined, () => undefined));
    return cached;
  }
  return network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode === "navigate" || request.headers.has("range")) return;
  // RSC payloads (client navigations / prefetches) are build- and data-specific.
  if (request.headers.get("RSC") || request.headers.get("Next-Router-Prefetch")) return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request).catch(() => fetch(request)));
    return;
  }
  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/images/") || url.pathname === "/logo.png") {
    event.respondWith(staleWhileRevalidate(event, request).catch(() => fetch(request)));
  }
  // Everything else (documents, /api/**, /_next/image, media…): not intercepted.
});

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
