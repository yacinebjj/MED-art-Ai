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

/** Extracts raw text from a document buffer given its (lowercase, no-dot) extension. Throws on an unsupported extension or a parse failure — callers already validate the extension against ACCEPTED_DOCUMENT_EXTENSIONS first, so this is a second, defensive check, not the primary gate. */
export async function extractDocumentText(buffer: Buffer, extension: string): Promise<string> {
  if (extension === "txt") {
    return buffer.toString("utf-8").trim();
  }

  const fileType = OFFICEPARSER_FILE_TYPES[extension];
  if (!fileType) {
    throw new Error(`Extension non supportée : ".${extension}".`);
  }

  const ast = await OfficeParser.parseOffice(buffer, { fileType });
  return ast.toText().trim();
}
