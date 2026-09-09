import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { extractDocumentText } from "@/lib/document-extraction";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Bumped alongside the other upload routes' MAX_FILE_BYTES (see
// app/api/upload/route.ts) — a large image-heavy course file downloaded
// from Drive takes proportionally longer to extract too.
export const maxDuration = 300;

// Google Docs/Slides are NOT downloadable as bytes (they have no underlying
// file — "alt=media" 403s on them) — they must be EXPORTED to a real format
// first via Drive's dedicated export endpoint. Everything else (a real PDF/
// DOCX/PPTX/TXT the student actually uploaded to their Drive) downloads
// directly.
const GOOGLE_NATIVE_EXPORT: Record<string, { exportMimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": {
    exportMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
  "application/vnd.google-apps.presentation": {
    exportMimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
  },
};

const MIME_TO_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
};

// SECURITY: same 100 MB ceiling every other document-ingestion route
// enforces (app/api/upload/route.ts, app/api/study-planner/upload/route.ts)
// — this route was the one exception, buffering an arbitrarily large Drive
// file into memory with no size check at all before ever calling
// extractDocumentText, risking function memory/time exhaustion.
const MAX_DRIVE_IMPORT_BYTES = 100 * 1024 * 1024;

function formatOversizedFileError(bytes: number): string {
  return `Fichier trop volumineux (${(bytes / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_DRIVE_IMPORT_BYTES / (1024 * 1024)} Mo).`;
}

/**
 * Downloads one file the student just picked in the Drive browser (see
 * components/dashboard/DriveBrowser.tsx / lib/google-drive-picker.ts) and
 * runs it through the exact same text extraction as a local upload
 * (lib/document-extraction.ts), so from this point on a Drive import is
 * indistinguishable from a local file to every caller (UploadModal treats
 * the result like the "Texte brut" path).
 *
 * The access token is the short-lived OAuth token Google Identity Services'
 * popup token flow already obtained client-side (scope: drive.readonly) —
 * this route only ever uses it for one immediate download, never stores it.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`drive-import:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { fileId, mimeType, accessToken, fileName } = (body ?? {}) as {
    fileId?: unknown;
    mimeType?: unknown;
    accessToken?: unknown;
    fileName?: unknown;
  };

  if (typeof fileId !== "string" || !fileId.trim()) {
    return NextResponse.json({ success: false, error: "'fileId' est requis." }, { status: 400 });
  }
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    return NextResponse.json({ success: false, error: "'accessToken' est requis." }, { status: 400 });
  }
  if (typeof mimeType !== "string" || !mimeType.trim()) {
    return NextResponse.json({ success: false, error: "'mimeType' est requis." }, { status: 400 });
  }

  const nativeExport = GOOGLE_NATIVE_EXPORT[mimeType];
  const extension = nativeExport?.extension ?? MIME_TO_EXTENSION[mimeType];
  if (!extension) {
    return NextResponse.json({ success: false, error: `Type de fichier Google Drive non supporté : "${mimeType}".` }, { status: 400 });
  }

  const driveUrl = nativeExport
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(nativeExport.exportMimeType)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;

  let buffer: Buffer;
  try {
    const driveRes = await fetch(driveUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!driveRes.ok) {
      // Distinguish an expired/revoked OAuth token from any other Drive
      // failure — the client can only offer a "Se reconnecter" affordance
      // (mirroring lib/google-drive-picker.ts's listDriveFiles/
      // DriveAuthExpiredError handling for the browsing path) if it can
      // actually tell the two apart, instead of showing this one specific,
      // recoverable case as an opaque, unlabeled failure.
      if (driveRes.status === 401) {
        return NextResponse.json(
          { success: false, error: "Ta session Google Drive a expiré. Reconnecte-toi pour réessayer.", authExpired: true },
          { status: 401 }
        );
      }
      const detail = await driveRes.text().catch(() => "");
      throw new Error(`Google Drive a répondu ${driveRes.status} : ${detail.slice(0, 200) || "erreur inconnue"}`);
    }

    // Reject on the DECLARED size before ever buffering — a real, malformed,
    // or hostile response could omit/understate this, so the post-buffer
    // check just below is the actual authoritative guard.
    const declaredLength = Number(driveRes.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DRIVE_IMPORT_BYTES) {
      return NextResponse.json({ success: false, error: formatOversizedFileError(declaredLength) }, { status: 413 });
    }

    buffer = Buffer.from(await driveRes.arrayBuffer());
    if (buffer.length > MAX_DRIVE_IMPORT_BYTES) {
      return NextResponse.json({ success: false, error: formatOversizedFileError(buffer.length) }, { status: 413 });
    }
  } catch (error) {
    console.error("[drive/import] Échec du téléchargement depuis Drive:", error);
    return NextResponse.json({ success: false, error: `Téléchargement depuis Google Drive échoué : ${errorMessage(error)}` }, { status: 502 });
  }

  let text: string;
  try {
    text = sanitizeForPostgres(await extractDocumentText(buffer, extension));
  } catch (error) {
    console.error(`[drive/import] Échec de l'extraction ${extension}:`, error);
    return NextResponse.json({ success: false, error: `Extraction échouée : ${errorMessage(error)}` }, { status: 422 });
  }

  if (text.length < 50) {
    return NextResponse.json(
      { success: false, error: "Le contenu est trop court ou illisible (pas assez de texte exploitable)." },
      { status: 422 }
    );
  }

  return NextResponse.json({ success: true, text, fileName: typeof fileName === "string" && fileName.trim() ? fileName : "Document Google Drive" });
}
