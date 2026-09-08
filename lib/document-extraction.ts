import { OfficeParser, type SupportedFileType } from "officeparser";

/**
 * Single source of truth for "which document formats can this app extract
 * text from" — shared by /api/upload, /api/generate-course, and
 * /api/drive/import so the three never drift apart on which extensions are
 * accepted. officeparser (already a dependency for PDF) natively parses
 * docx/pptx too; ".txt" isn't an office format at all, so it's read as
 * plain text directly instead of going through officeparser.
 */
const OFFICEPARSER_FILE_TYPES: Record<string, SupportedFileType> = { pdf: "pdf", docx: "docx", pptx: "pptx" };

export const ACCEPTED_DOCUMENT_EXTENSIONS = [...Object.keys(OFFICEPARSER_FILE_TYPES), "txt"];

/**
 * Default bound on a single extraction call — officeparser/pdfjs-dist have
 * NO built-in timeout of their own (no AbortSignal is passed here), and a
 * known internal fallback path (PDF worker resolution) can attempt a live
 * network fetch to a CDN if Next.js's serverless bundling ever mis-resolves
 * the local worker file — a real, confirmed hang vector, not a hypothetical
 * one. Without this, a stuck extraction would otherwise only ever be bounded
 * by the CALLING ROUTE's own `maxDuration` (5 minutes), which is exactly
 * what production reports described as the upload UI "hanging" with zero
 * feedback. 120s is generous for a genuinely large/complex real document
 * while still failing fast enough to be actionable.
 */
const DEFAULT_EXTRACTION_TIMEOUT_MS = 120_000;

/** Extracts raw text from a document buffer given its (lowercase, no-dot) extension. Throws on an unsupported extension, a parse failure, or — via `timeoutMs` (default DEFAULT_EXTRACTION_TIMEOUT_MS) — a clean, specific timeout error instead of hanging indefinitely. Callers already validate the extension against ACCEPTED_DOCUMENT_EXTENSIONS first, so the extension check here is a second, defensive check, not the primary gate. */
export async function extractDocumentText(buffer: Buffer, extension: string, timeoutMs: number = DEFAULT_EXTRACTION_TIMEOUT_MS): Promise<string> {
  if (extension === "txt") {
    return buffer.toString("utf-8").trim();
  }

  const fileType = OFFICEPARSER_FILE_TYPES[extension];
  if (!fileType) {
    throw new Error(`Extension non supportée : ".${extension}".`);
  }

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("L'extraction a pris trop de temps — le fichier est peut-être trop volumineux ou trop complexe.")),
      timeoutMs
    );
  });

  try {
    const ast = await Promise.race([OfficeParser.parseOffice(buffer, { fileType }), timeout]);
    return ast.toText().trim();
  } finally {
    clearTimeout(timeoutId!);
  }
}
