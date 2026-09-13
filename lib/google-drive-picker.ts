"use client";

/**
 * Thin client-side wrapper around Google Identity Services' OAuth token
 * popup flow + the Drive REST API v3 — lets a student browse their own
 * Drive (Récents / Mon Drive / Partagés avec moi) and pick a file, entirely
 * inside our own responsive UI (see components/dashboard/DriveBrowser.tsx).
 *
 * Previously this rendered Google's own hosted Picker widget
 * (google.picker.PickerBuilder) inside an iframe. That widget has two real,
 * externally-documented limitations that no amount of our own config could
 * fix: (1) with third-party cookies blocked (Chrome's default now), the
 * Picker's internal account-chooser sometimes renders a dead "Sign in to
 * your Google Account" box INSIDE its own iframe instead of using the
 * already-granted OAuth token, and (2) its internal layout is fixed/
 * desktop-oriented and not meaningfully responsive below tablet width, no
 * matter how the outer iframe is sized. Talking to the Drive REST API
 * directly (Bearer token, no iframe at all) removes both failure classes
 * at the source instead of working around them.
 *
 * Only needs a Web application OAuth 2.0 Client ID from Google Cloud
 * Console (Authorized JavaScript origins covering this domain) with the
 * Drive API enabled — no API key, no "Google Picker API" enablement
 * needed anymore (that was Picker-widget-specific; a Bearer-token REST
 * call authenticates entirely via the OAuth token).
 */

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// Broader than the old Picker flow's drive.file (which only grants access to
// files the widget itself hands back) — our own browsing UI needs to LIST
// files the student hasn't explicitly picked yet (Récents/Mon Drive/
// Partagés avec moi), which requires read access to the whole Drive.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

// Same supported formats as the rest of the import pipeline
// (app/api/drive/import/route.ts's GOOGLE_NATIVE_EXPORT/MIME_TO_EXTENSION,
// lib/constants.ts's ACCEPTED_FILE_TYPES) — kept as a single source of
// truth here since it drives the Drive API `q=` filter below.
export const SUPPORTED_DRIVE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain",
  "application/vnd.google-apps.document", // Google Docs (exported server-side, see app/api/drive/import)
  "application/vnd.google-apps.presentation", // Google Slides (exported server-side)
];

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export interface DriveListItem {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  modifiedTime?: string;
  isFolder: boolean;
}

// A blocked/stalled script request doesn't always fire the element's own
// `error` event (some ad/privacy blockers, or a request that just hangs
// rather than failing outright) — without a bound, `loadScriptOnce` could
// wait forever, and every caller above it (ensureGoogleScripts,
// requestAccessToken) would hang right along with it: the Import button
// spinning forever with zero error, indistinguishable from the "click does
// nothing" production report. Same pattern/rationale as
// ACCESS_TOKEN_TIMEOUT_MS below, applied one step earlier in the flow.
const SCRIPT_LOAD_TIMEOUT_MS = 20_000;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    // Only trust an existing tag if IT already finished loading (marked via
    // data-loaded below) — a tag left behind by a PREVIOUS attempt that
    // timed out/errored is NOT proof the script ever actually loaded
    // (window.google could still be undefined). Without this distinction,
    // retrying after a genuine failure would silently "succeed" from the
    // stale tag and crash one step later on window.google.accounts... being
    // called on undefined — a real, confirmed gap in the first version of
    // this fix.
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
    google: any;
  }
}

/**
 * Fire-and-forget, safe to call multiple times (loadScriptOnce's own
 * document.querySelector short-circuit makes every call after the first a
 * near-instant no-op) — call this as EARLY as possible (e.g. the moment the
 * upload modal opens), well before the student actually clicks "Se
 * connecter à Google Drive". Real production issue this fixes:
 * requestAccessToken used to be reached only after an `await` on this
 * script load, INSIDE the click handler itself, before ever calling
 * Google's own popup-opening `requestAccessToken()` on the token client —
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
  if (!GOOGLE_CLIENT_ID) return;
  void ensureGoogleScripts().catch((error) => {
    // Best-effort only — a failed preload just means the "Se connecter"
    // click handler's own await ensureGoogleScripts() call (still in place,
    // unchanged) retries it and surfaces the real error normally at that
    // point.
    console.warn("[google-drive-picker] Préchargement des scripts Google échoué (non bloquant, réessayé au clic):", error);
  });
}

async function ensureGoogleScripts(): Promise<void> {
  await loadScriptOnce("https://accounts.google.com/gsi/client");
}

// Google Identity Services only invokes `callback` on an explicit outcome
// (consent granted, consent denied, popup closed by the user). If the
// production OAuth Client ID is missing "Authorized JavaScript origins" for
// this domain, or the consent screen is still in "Testing" mode and this
// student isn't an allow-listed test user, Google renders its own dead-end
// error page INSIDE the popup — and in both cases the callback frequently
// never fires at all. Without a timeout, that left the "Se connecter"
// button spinning forever with zero feedback, indistinguishable from
// "nothing happens" (found during a production bug report — this is not
// hypothetical).
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

/**
 * Opens Google's OAuth consent popup and resolves with a short-lived
 * (~1h) access token scoped to drive.readonly. Never stored beyond the
 * caller's own in-memory state — re-requested fresh every time the student
 * opens the Drive browser in a new modal session.
 */
export async function requestAccessToken(): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google Drive n'est pas configuré (NEXT_PUBLIC_GOOGLE_CLIENT_ID manquant).");
  }

  await ensureGoogleScripts();

  return new Promise((resolve, reject) => {
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

export type DriveSection = "recent" | "mydrive" | "shared";

export interface ListDriveFilesOptions {
  section: DriveSection;
  /** Folder to list the contents of — "mydrive" section only. Omit/undefined means the Drive root. */
  folderId?: string;
  /** Free-text search — when set, overrides the section's own query (searches across all of Drive, matching NotebookLM's own picker behavior). */
  searchQuery?: string;
  pageToken?: string;
}

interface ListDriveFilesResult {
  files: DriveListItem[];
  nextPageToken?: string;
}

/**
 * Thrown by listDriveFiles specifically for a 401 — lets callers offer a
 * distinct "Se reconnecter" action (drop the stale token, request a fresh
 * one) instead of blindly retrying a request that will just fail the same
 * way again with the same expired token.
 */
export class DriveAuthExpiredError extends Error {}

/** Drive API `q=` string values need single quotes escaped — see https://developers.google.com/drive/api/guides/ref-search-terms */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildMimeTypeClause(includeFolders: boolean): string {
  const types = includeFolders ? [...SUPPORTED_DRIVE_MIME_TYPES, FOLDER_MIME_TYPE] : SUPPORTED_DRIVE_MIME_TYPES;
  return `(${types.map((t) => `mimeType='${t}'`).join(" or ")})`;
}

function buildDriveQuery(opts: ListDriveFilesOptions): string {
  const clauses = ["trashed=false"];

  if (opts.searchQuery?.trim()) {
    clauses.push(`name contains '${escapeDriveQueryValue(opts.searchQuery.trim())}'`);
    clauses.push(buildMimeTypeClause(true));
    return clauses.join(" and ");
  }

  if (opts.section === "recent") {
    clauses.push(buildMimeTypeClause(false));
  } else if (opts.section === "shared") {
    clauses.push("sharedWithMe=true");
    clauses.push(buildMimeTypeClause(false));
  } else {
    clauses.push(`'${escapeDriveQueryValue(opts.folderId ?? "root")}' in parents`);
    clauses.push(buildMimeTypeClause(true));
  }

  return clauses.join(" and ");
}

// Same rationale as SCRIPT_LOAD_TIMEOUT_MS/ACCESS_TOKEN_TIMEOUT_MS above — this
// call fires far more often than either of those (every section switch,
// folder click, search keystroke, and "Charger plus" click), so a stalled
// connection here (e.g. a student on flaky mobile data) would otherwise leave
// DriveBrowser's loading spinner spinning forever with zero feedback, the
// exact bug class this file's other two async steps were already hardened
// against.
const DRIVE_LIST_TIMEOUT_MS = 20_000;

/**
 * Lists one page of the student's Drive files for the given section/folder/
 * search, via a direct Bearer-token REST call — no iframe, no Picker widget,
 * fully under our own UI's control (see components/dashboard/DriveBrowser.tsx).
 * Throws on any non-OK response, including a 401 from an expired access
 * token — callers should catch that and prompt for a fresh
 * requestAccessToken() rather than retrying blindly.
 */
export async function listDriveFiles(accessToken: string, opts: ListDriveFilesOptions): Promise<ListDriveFilesResult> {
  const params = new URLSearchParams({
    q: buildDriveQuery(opts),
    fields: "files(id,name,mimeType,iconLink,modifiedTime),nextPageToken",
    pageSize: "30",
    orderBy: opts.section === "recent" && !opts.searchQuery ? "viewedByMeTime desc" : "folder,name",
    spaces: "drive",
  });
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DRIVE_LIST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Google Drive n'a pas répondu à temps. Vérifie ta connexion et réessaie.");
    }
    // A genuine dropped connection (e.g. a mobile network blip) — the only
    // other case this function can throw from besides a non-OK response,
    // and previously the one path left unwrapped in French, unlike its
    // sibling branch just above.
    throw new Error("La connexion à Google Drive a été interrompue. Vérifie ta connexion et réessaie.");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new DriveAuthExpiredError("Ta session Google Drive a expiré. Reconnecte-toi pour continuer à parcourir tes fichiers.");
    }
    // A rate limit is retryable and self-resolving in seconds — worth a
    // distinct, actionable message instead of Google's raw JSON error body
    // (the generic branch below), which every other non-OK status still
    // falls into unchanged.
    if (res.status === 429) {
      throw new Error("Trop de requêtes envoyées à Google Drive — patiente quelques secondes puis réessaie.");
    }
    const detail = await res.text().catch(() => "");
    throw new Error(`Google Drive a répondu ${res.status}${detail ? ` : ${detail.slice(0, 200)}` : ""}.`);
  }

  // Only the fields this app actually reads — Drive's real files.list
  // response carries dozens more (permissions, capabilities, thumbnails…)
  // that this app has no use for and deliberately never requests (see the
  // `fields` param built above), so there is nothing to gain from typing
  // fields this code never touches.
  interface DriveApiFile {
    id: string;
    name: string;
    mimeType: string;
    iconLink?: string;
    modifiedTime?: string;
  }
  const data = (await res.json()) as { files?: DriveApiFile[]; nextPageToken?: string };
  const files: DriveListItem[] = (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    iconLink: f.iconLink,
    modifiedTime: f.modifiedTime,
    isFolder: f.mimeType === FOLDER_MIME_TYPE,
  }));

  return { files, nextPageToken: data.nextPageToken };
}
