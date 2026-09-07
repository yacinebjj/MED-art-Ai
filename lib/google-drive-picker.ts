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

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Échec du chargement de ${src}`));
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

async function ensureGoogleScripts(): Promise<void> {
  await Promise.all([
    loadScriptOnce("https://apis.google.com/js/api.js"),
    loadScriptOnce("https://accounts.google.com/gsi/client"),
  ]);

  if (!gapiPickerLoaded) {
    await new Promise<void>((resolve, reject) => {
      window.gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Échec du chargement de Google Picker.")) });
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

  return new Promise((resolve, reject) => {
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setMimeTypes(PICKER_MIME_TYPES)
      .setSelectFolderEnabled(false);

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setCallback((data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const doc = data.docs[0];
          resolve({ id: doc.id, name: doc.name, mimeType: doc.mimeType, accessToken });
        } else if (data.action === window.google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();

    try {
      picker.setVisible(true);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Échec de l'ouverture du sélecteur Google Drive."));
    }
  });
}
