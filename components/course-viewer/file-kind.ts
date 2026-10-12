/**
 * Which renderer shows a course's original file. Pure (no React, no DOM), so
 * the routing decision can't be broken by UI changes elsewhere.
 *
 *  - pdf    → PdfViewer (react-pdf / pdf.js, continuous scroll)
 *  - pptx   → PptxViewer (@aiden0z/pptx-renderer, one slide at a time)
 *  - office → Microsoft Office Online embed (DOCX/XLSX: no reliable
 *             in-browser renderer, and a flat-text spreadsheet is worse)
 *  - native → the browser renders the URL itself (images, plain files)
 *  - text   → the server-extracted text. Pasted-text courses (no file),
 *             courses uploaded before files were stored, and legacy binary
 *             .ppt (not OOXML: no browser library can parse it).
 */
export type ViewerKind = "pdf" | "pptx" | "office" | "native" | "text";

const PPTX_EXTENSIONS = new Set(["pptx", "ppsx", "pptm", "potx"]);
const OFFICE_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx"]);
const TEXT_EXTENSIONS = new Set(["ppt", "txt", "md"]);

/** Lower-case extension of a URL or file name, ignoring query/hash and URL-encoding. "" when there is none. */
export function getExtension(value: string): string {
  let path = value.split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escape sequence: the raw path still has the extension.
  }
  const lastSegment = path.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  return dot > 0 ? lastSegment.slice(dot + 1).toLowerCase() : "";
}

/**
 * The extension baked into the Storage path wins: it comes straight from the
 * original file name at upload time (app/api/upload/route.ts), while `title`
 * can be edited later. `title` is only a fallback.
 */
export function resolveViewerKind(fileUrl: string | null, title: string): ViewerKind {
  if (!fileUrl) return "text";
  const extension = getExtension(fileUrl) || getExtension(title);
  if (extension === "pdf") return "pdf";
  if (PPTX_EXTENSIONS.has(extension)) return "pptx";
  if (OFFICE_EXTENSIONS.has(extension)) return "office";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "native";
}

export function officeEmbedUrl(fileUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
}
