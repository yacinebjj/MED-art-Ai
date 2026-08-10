import { NextRequest, NextResponse } from "next/server";
import { OfficeParser } from "officeparser";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs"; // officeparser needs the Node runtime, not edge.

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 Mo — same cap as /api/generate-course.

/**
 * Extracts a PDF's raw text for the generic Studio workspace
 * (app/dashboard/module/[id]/page.tsx). Deliberately does NOT create any
 * Supabase row — unlike /api/generate-course (the real per-course pipeline),
 * this is the lightweight, ephemeral flow: the extracted text is handed back
 * to the client, which holds it in memory (`documentContext`) and resends it
 * with every /api/studio/generate call. Reuses officeparser, the PDF library
 * already used by /api/generate-course, rather than adding a second
 * PDF-parsing dependency for the exact same job.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`upload:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Aucun fichier reçu." }, { status: 400 });
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "pdf") {
    return NextResponse.json({ success: false, error: `Seuls les fichiers PDF sont acceptés (reçu : ".${extension}").` }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_FILE_BYTES / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  let text: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ast = await OfficeParser.parseOffice(buffer, { fileType: "pdf" });
    text = sanitizeForPostgres(ast.toText().trim());
  } catch (error) {
    console.error("[upload] Échec de l'extraction PDF (officeparser):", error);
    return NextResponse.json({ success: false, error: `Extraction PDF échouée : ${errorMessage(error)}` }, { status: 422 });
  }

  if (text.length < 50) {
    return NextResponse.json(
      { success: false, error: "Le contenu est trop court ou illisible (pas assez de texte exploitable)." },
      { status: 422 }
    );
  }

  return NextResponse.json({ success: true, text, fileName: file.name });
}
