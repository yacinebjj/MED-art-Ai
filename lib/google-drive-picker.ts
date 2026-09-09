"use client";

/**
 * Thin client-side wrapper around Google's Picker API + Identity Services
 * OAuth token flow — the standard way to let a user pick ONE file from their
 * own Drive without your server ever needing broad, persistent Drive access
 * (the token requested here is short-lived and scoped to
 * drive.readonly/drive.file, not a stored refresh token).
 *
 * Requires two Google Cloud Console setup steps before this can work at all
 * (see the two env vars below): a Web application OAuth 2.0 Client ID, and
 * an API key with the "Google Picker API" enabled. Both are DESIGNED to be
 * public/client-exposed — restricted server-side by Google via "Authorized
 * JavaScript origins" on the Client ID and API key referrer restrictions,
 * not by secrecy — which is why they're NEXT_PUBLIC_ and not server-only.
 */

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;

// Scopes down to files the picker itself lets the user select, rather than
// blanket read access to the whole Drive — the narrowest scope the Picker
// API supports for a one-off "import this file" flow.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const PICKER_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain",
  "application/vnd.google-apps.document", // Google Docs (needs export, see app/api/drive/import)
  "application/vnd.google-apps.presentation", // Google Slides (needs export)
].join(",");

export interface DrivePickedFile {
  id: string;
  name: string;
  mimeType: string;
}

// A blocked/stalled script request doesn't always fire the element's own
// `error` event (some ad/privacy blockers, or a request that just hangs
// rather than failing outright) — without a bound, `loadScriptOnce` could
// wait forever, and every caller above it (ensureGoogleScripts,
// openGoogleDrivePicker, handleDriveImport) would hang right along with it:
// the Import button spinning forever with zero error, indistinguishable
// from the "click does nothing" production report. Same pattern/rationale
// as ACCESS_TOKEN_TIMEOUT_MS below, applied one step earlier in the flow.
const SCRIPT_LOAD_TIMEOUT_MS = 20_000;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    // Only trust an existing tag if IT already finished loading (marked via
    // data-loaded below) — a tag left behind by a PREVIOUS attempt that
    // timed out/errored is NOT proof the script ever actually loaded
    // (window.gapi/window.google could still be undefined). Without this
    // distinction, retrying after a genuine failure would silently
    // "succeed" from the stale tag and crash one step later on
    // window.gapi.load(...)/window.google.accounts... being called on
    // undefined — a real, confirmed gap in the first version of this fix.
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    if (existing) existing.remove();

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      script.remove();
      reject(new Error("Impossible de charger les services Google — vérifie ta connexion ou désactive ton bloqueur de publicités, puis réessaie."));
    }, SCRIPT_LOAD_TIMEOUT_MS);
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      script.remove();
      reject(new Error(`Échec du chargement de ${src}`));
    };
    document.body.appendChild(script);
  });
}

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

let gapiPickerLoaded = false;

/**
 * Fire-and-forget, safe to call multiple times (loadScriptOnce's own
 * document.querySelector short-circuit makes every call after the first a
 * near-instant no-op) — call this as EARLY as possible (e.g. the moment the
 * upload modal opens), well before the student actually clicks "Importer
 * depuis Drive". Real production issue this fixes: openGoogleDrivePicker
 * used to `await ensureGoogleScripts()` INSIDE the click handler itself,
 * before ever calling Google's own popup-opening `requestAccessToken()` —
 * that `await` is a genuine async gap between the click and the popup call,
 * and several mobile browsers (Safari in particular) only grant "trusted
 * user gesture" popup privileges to a `window.open` call that happens
 * SYNCHRONOUSLY within the original click/tap handler, revoking it across
 * any intervening microtask/macrotask boundary. A cold script load (even a
 * fast one) is exactly such a gap — the likely real cause of Google's own
 * popup silently failing to open ("hangs or does nothing") even once the
 * Client ID's Authorized JavaScript origins are correctly configured.
 * Preloading here means that by the time the click handler actually runs,
 * ensureGoogleScripts() resolves synchronously-fast (already-loaded scripts,
 * no real await), keeping the gesture fresh through to requestAccessToken().
 */
export function preloadGoogleDriveScripts(): void {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY) return;
  void ensureGoogleScripts().catch((error) => {
    // Best-effort only — a failed preload just means the click handler's
    // own await ensureGoogleScripts() call (still in place, unchanged)
    // retries it and surfaces the real error normally at that point.
    console.warn("[google-drive-picker] Préchargement des scripts Google échoué (non bloquant, réessayé au clic):", error);
  });
}

async function ensureGoogleScripts(): Promise<void> {
  await Promise.all([
    loadScriptOnce("https://apis.google.com/js/api.js"),
    loadScriptOnce("https://accounts.google.com/gsi/client"),
  ]);

  if (!gapiPickerLoaded) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Le chargement du sélecteur Google Drive a pris trop de temps — réessaie."));
      }, SCRIPT_LOAD_TIMEOUT_MS);
      window.gapi.load("picker", {
        callback: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve();
        },
        onerror: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          reject(new Error("Échec du chargement de Google Picker."));
        },
      });
    });
    gapiPickerLoaded = true;
  }
}

// Google Identity Services only invokes `callback` on an explicit outcome
// (consent granted, consent denied, popup closed by the user). If the
// production OAuth Client ID is missing "Authorized JavaScript origins" for
// this domain, or the consent screen is still in "Testing" mode and this
// student isn't an allow-listed test user, Google renders its own dead-end
// error page INSIDE the popup — and in both cases the callback frequently
// never fires at all. Without a timeout, that left the Import button
// spinning forever with zero feedback, indistinguishable from "nothing
// happens" (found during a production bug report — this is not hypothetical).
const ACCESS_TOKEN_TIMEOUT_MS = 90_000;

/**
 * Google Identity Services' OWN documented mechanism for exactly this
 * (https://developers.google.com/identity/oauth2/web/reference/js-reference)
 * — `error_callback` receives `{ type }` for a handful of non-OAuth
 * failures, including `"popup_failed_to_open"` (the browser blocked the
 * popup outright) and `"popup_closed"` (the student closed it before
 * finishing). Using GIS's own signal here instead of a home-grown
 * window.open() probe avoids two real risks a probe would add: an extra
 * popup call that could itself confuse a strict browser's "how many popups
 * did this one gesture open" heuristic, and a false negative/positive from
 * guessing at browser-specific window.open() return-value quirks.
 */
type TokenClientErrorType = "popup_failed_to_open" | "popup_closed" | "unknown";

function messageForTokenClientError(type: TokenClientErrorType): string {
  if (type === "popup_failed_to_open") {
    return "La fenêtre Google Drive a été bloquée par ton navigateur. Autorise les fenêtres surgissantes (pop-ups) pour ce site, puis réessaie.";
  }
  if (type === "popup_closed") {
    return "Tu as fermé la fenêtre Google avant la fin de la connexion — réessaie si tu veux importer un fichier.";
  }
  return "La connexion à Google a échoué. Réessaie dans un instant.";
}

function requestAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) {
      reject(new Error("Google Drive n'est pas configuré (NEXT_PUBLIC_GOOGLE_CLIENT_ID manquant)."));
      return;
    }
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          "La fenêtre Google n'a pas répondu. Vérifie que ton compte est autorisé pour cette application, ou réessaie."
        )
      );
    }, ACCESS_TOKEN_TIMEOUT_MS);

    // No `await` (or any other async gap) between this call and the click
    // handler that led here — see preloadGoogleDriveScripts' own comment for
    // why that matters: this call must stay inside the same trusted user
    // gesture as the original tap for the browser to allow the popup at all.
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (response: { access_token?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Autorisation Google refusée."));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: (error: { type?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        const type: TokenClientErrorType =
          error?.type === "popup_failed_to_open" || error?.type === "popup_closed" ? error.type : "unknown";
        reject(new Error(messageForTokenClientError(type)));
      },
    });
    tokenClient.requestAccessToken();
  });
}

/**
 * Opens the Google Drive file picker and resolves with the chosen file's
 * {id, name, mimeType}, or `null` if the student closes the picker without
 * choosing anything. The actual file bytes are fetched server-side
 * afterward (see app/api/drive/import/route.ts) using this same access
 * token, so this function never downloads file content itself.
 */
export async function openGoogleDrivePicker(): Promise<(DrivePickedFile & { accessToken: string }) | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY) {
    throw new Error(
      "Google Drive n'est pas configuré côté serveur (NEXT_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_GOOGLE_API_KEY manquants dans .env.local)."
    );
  }

  await ensureGoogleScripts();
  const accessToken = await requestAccessToken();

  // Same class of risk as the two steps above (script loading, OAuth token
  // request) — a Picker API misconfiguration (API key missing the "Google
  // Picker API" enablement, or a referrer restriction mismatch — a DIFFERENT
  // failure mode than the Client ID/API key presence check above, since the
  // widget itself renders but its callback then never fires PICKED or
  // CANCEL) left this specific promise with no timeout at all in the first
  // version of this fix — the last remaining unguarded async step in the
  // whole Drive-import chain, and a real way for the "click does nothing,
  // spins forever" bug class to survive one step further down the pipeline.
  const PICKER_DISPLAY_TIMEOUT_MS = 90_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Le sélecteur Google Drive n'a pas répondu. Vérifie la configuration de l'API Picker, ou réessaie."));
    }, PICKER_DISPLAY_TIMEOUT_MS);

    try {
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setMimeTypes(PICKER_MIME_TYPES)
        .setSelectFolderEnabled(false);

      // Explicit origin for the Picker <-> parent-window postMessage
      // handshake — Google's own documented guard against a real (if rare)
      // class of cross-origin failure where the widget renders but its
      // PICKED/CANCEL callback never reaches this page. Costs nothing when
      // everything is already working.
      const builder = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setOrigin(window.location.origin);

      // Google's Picker defaults to fixed, desktop-oriented dimensions —
      // on a real phone viewport that renders as a cramped box with
      // barely-tappable rows. Sizing it to the actual viewport (capped at
      // a sane minimum so a tiny/foldable screen doesn't get an unusably
      // small picker either) fixes that without needing any custom
      // overlay — the Picker's own iframe just fills the space it's given.
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        builder.setSize(Math.max(window.innerWidth, 320), Math.max(window.innerHeight, 480));
      }

      const picker = builder
        .setCallback((data: any) => {
          if (settled) return;
          if (data.action === window.google.picker.Action.PICKED) {
            const doc = data.docs[0];
            settled = true;
            clearTimeout(timeoutId);
            resolve({ id: doc.id, name: doc.name, mimeType: doc.mimeType, accessToken });
          } else if (data.action === window.google.picker.Action.CANCEL) {
            settled = true;
            clearTimeout(timeoutId);
            resolve(null);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error("Échec de l'ouverture du sélecteur Google Drive."));
    }
  });
}
