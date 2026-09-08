import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { ACCEPTED_DOCUMENT_EXTENSIONS, extractDocumentText } from "@/lib/document-extraction";
import { SOURCE_FILES_BUCKET } from "@/lib/course-source-storage";
import { createStudioCourse } from "@/lib/studio-course-create";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs"; // officeparser needs the Node runtime, not edge.
export const maxDuration = 300; // a large/image-heavy PDF can take a while to parse — see app/api/upload/route.ts's own identical comment.

/**
 * Turns a raw extraction error into an actionable French message instead of
 * whatever raw string officeparser/pdfjs-dist happened to throw — "bulletproof
 * error handling" per the production report this fixes: a crash should never
 * just surface a cryptic internal error with no next step for the student.
 * Pattern-matched against known, real failure classes (see
 * lib/document-extraction.ts's own investigation comments); anything
 * unrecognized falls back to the raw message, never silently hidden.
 */
function classifyExtractionError(error: unknown): string {
  const raw = errorMessage(error);
  const lower = raw.toLowerCase();
  if (lower.includes("trop de temps")) {
    return raw; // already the clear, specific timeout message from extractDocumentText.
  }
  if (lower.includes("password") || lower.includes("encrypted") || lower.includes("mot de passe")) {
    return "Ce fichier est protégé par un mot de passe — retire la protection puis réessaie.";
  }
  if (
    lower.includes("end of central directory") ||
    lower.includes("invalid xml") ||
    lower.includes("failed to open zip") ||
    lower.includes("corrupt")
  ) {
    return "Ce fichier semble corrompu ou dans un format invalide — essaie de le réexporter puis réessaie.";
  }
  return raw;
}

/**
 * Step 2 of the direct-to-storage upload pipeline (see app/api/upload/sign
 * for step 1). The browser has already PUT the file bytes straight to
 * Supabase Storage using the signed URL from step 1 — this route never
 * receives the file body itself, only a tiny JSON pointer to where it
 * already lives, so it's never subject to Vercel's ~4.5 MB request-body
 * ceiling regardless of how large the actual file is. Downloads the file
 * SERVER-TO-SERVER from Storage (not bound by that same request-body limit
 * — it's an outbound/inbound call between this server and Supabase, not an
 * incoming client request), extracts its text exactly like the legacy
 * /api/upload route did, and returns the identical response shape
 * ({success, text, fileName, fileUrl}) so nothing downstream of this call
 * (app/dashboard/module/[id]/page.tsx's handleFileSelected, the Assistant's
 * handlePdfFileChosen) needs to change beyond how they get here.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`upload-finalize:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  const { path, fileName, moduleId } = (body ?? {}) as { path?: unknown; fileName?: unknown; moduleId?: unknown };
  if (typeof path !== "string" || !path.trim()) {
    return NextResponse.json({ success: false, error: "'path' est requis." }, { status: 400 });
  }
  if (typeof fileName !== "string" || !fileName.trim()) {
    return NextResponse.json({ success: false, error: "'fileName' est requis." }, { status: 400 });
  }
  // Optional — when the caller already knows which curriculum module this
  // upload belongs to (the Studio workspace flow), pass it here and this
  // route creates the studio_courses row directly, server-to-server, instead
  // of returning the (possibly large) extracted text for the browser to turn
  // around and POST straight back to /api/studio/courses. That round-trip
  // would reintroduce, one hop later, the exact request-body-size problem
  // this whole direct-to-storage pipeline exists to avoid — a huge course's
  // extracted text is exactly the kind of payload that could itself approach
  // Vercel's ~4.5 MB request-body ceiling. Absent for callers that only want
  // the extracted text with no course row at all (the Assistant's "Importer
  // un PDF" attachment flow).
  if (moduleId !== undefined && (typeof moduleId !== "number" || !Number.isFinite(moduleId))) {
    return NextResponse.json({ success: false, error: "'moduleId' doit être un nombre." }, { status: 400 });
  }

  // Every uploaded file's path is namespaced `${userId}/...` (see
  // buildSourceFilePath) — this is the one check standing in for real
  // Storage-level RLS on the download side, refusing to finalize a path
  // that doesn't belong to the caller even if they somehow guessed/leaked
  // another student's object path.
  if (!path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ success: false, error: "Chemin de fichier invalide." }, { status: 403 });
  }

  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)) {
    return NextResponse.json(
      { success: false, error: `Format non supporté (reçu : ".${extension}"). Formats acceptés : PDF, DOCX, PPTX, TXT.` },
      { status: 400 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: fileBlob, error: downloadError } = await supabase.storage.from(SOURCE_FILES_BUCKET).download(path);
  if (downloadError || !fileBlob) {
    console.error("[upload/finalize] Échec téléchargement depuis Storage:", downloadError);
    return NextResponse.json(
      { success: false, error: "Le fichier envoyé est introuvable (l'envoi a peut-être échoué ou expiré — réessaie)." },
      { status: 404 }
    );
  }

  let text: string;
  try {
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    text = sanitizeForPostgres(await extractDocumentText(buffer, extension));
  } catch (error) {
    console.error(`[upload/finalize] Échec de l'extraction ${extension}:`, error);
    return NextResponse.json({ success: false, error: `Extraction échouée : ${classifyExtractionError(error)}` }, { status: 422 });
  }

  if (text.length < 50) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Le contenu est trop court ou illisible — ce PDF est peut-être un document scanné/image sans texte réel (l'extraction automatique ne fonctionne alors pas). Essaie un autre fichier, idéalement exporté directement en PDF texte.",
      },
      { status: 422 }
    );
  }

  const { data: publicUrlData } = supabase.storage.from(SOURCE_FILES_BUCKET).getPublicUrl(path);
  const fileUrl = publicUrlData.publicUrl;

  if (typeof moduleId === "number") {
    try {
      const course = await createStudioCourse({ userId: user.id, moduleId, title: fileName, rawText: text, sourceFileUrl: fileUrl });
      return NextResponse.json({ success: true, course, text, fileName, fileUrl });
    } catch (error) {
      console.error("[upload/finalize] Échec création du cours:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, text, fileName, fileUrl });
}
