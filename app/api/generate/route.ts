import { NextRequest, NextResponse } from "next/server";
import { OfficeParser } from "officeparser";
import { insertUserCourse } from "@/lib/user-courses";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import type { SourceFileType } from "@/lib/types";

export const runtime = "nodejs";

const EXTENSION_TO_FILE_TYPE: Record<string, Extract<SourceFileType, "pdf" | "docx" | "pptx">> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
};

function formatSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Upload handler — "Fichier" and "Texte" tabs of the upload modal both land
 * here. This ONLY extracts and stores the source text; it never calls the
 * AI. Every Studio artifact (including the default "Cours Oral" transcript)
 * is generated on demand by /api/courses/[id]/generate — that's where the
 * cost-saving cache-check actually happens.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Tu dois être connecté(e) pour ajouter un cours." },
      { status: 401 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const pastedText = formData.get("text");
  const pastedTitle = formData.get("title");

  // --- "Texte" tab: no file, just pasted course text ---
  if (typeof pastedText === "string" && pastedText.trim().length > 0) {
    const text = pastedText.trim();
    if (text.length < 50) {
      return NextResponse.json(
        { error: "Le texte est trop court pour être analysé (50 caractères minimum)." },
        { status: 422 }
      );
    }

    const title =
      typeof pastedTitle === "string" && pastedTitle.trim() ? pastedTitle.trim() : "Cours (texte collé)";

    const course = await insertUserCourse({
      userId: user.id,
      title,
      subject: "Cours importé",
      fileType: "txt",
      fileSizeLabel: `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} Ko`,
      status: "ready",
      sourceText: text,
    });

    if (!course) {
      return NextResponse.json(
        { error: "Impossible d'enregistrer ce cours pour le moment." },
        { status: 500 }
      );
    }

    return NextResponse.json({ course });
  }

  // --- "Fichier" tab: PDF / PPTX / DOCX upload ---
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const fileType = EXTENSION_TO_FILE_TYPE[extension];
  if (!fileType) {
    return NextResponse.json(
      { error: "Format non supporté. Utilise un fichier PDF, PPTX ou DOCX." },
      { status: 400 }
    );
  }

  const title = file.name.replace(/\.[^/.]+$/, "");
  const fileSizeLabel = formatSize(file.size);
  const buffer = Buffer.from(await file.arrayBuffer());

  let courseText: string;
  try {
    const ast = await OfficeParser.parseOffice(buffer, { fileType });
    courseText = ast.toText();
  } catch (error) {
    console.error("officeparser failed", error);
    const message =
      "Impossible d'extraire le texte de ce fichier. Vérifie qu'il n'est pas corrompu ou protégé par mot de passe.";
    const course = await insertUserCourse({
      userId: user.id,
      title,
      subject: "Échec de l'analyse",
      fileType,
      fileSizeLabel,
      status: "error",
      errorMessage: message,
    });
    return NextResponse.json({ error: message, course }, { status: 422 });
  }

  if (!courseText || courseText.trim().length < 50) {
    const message = "Le document semble vide ou illisible (pas assez de texte extrait).";
    const course = await insertUserCourse({
      userId: user.id,
      title,
      subject: "Échec de l'analyse",
      fileType,
      fileSizeLabel,
      status: "error",
      errorMessage: message,
    });
    return NextResponse.json({ error: message, course }, { status: 422 });
  }

  const course = await insertUserCourse({
    userId: user.id,
    title,
    subject: "Cours importé",
    fileType,
    fileSizeLabel,
    status: "ready",
    sourceText: courseText,
  });

  if (!course) {
    return NextResponse.json(
      { error: "Impossible d'enregistrer ce cours pour le moment." },
      { status: 500 }
    );
  }

  return NextResponse.json({ course });
}
