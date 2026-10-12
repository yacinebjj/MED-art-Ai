export const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Lower-cased extension of a file name or URL, ignoring any query string / hash. */
export function fileExtension(value: string | null | undefined): string {
  if (!value) return "";
  const path = value.split(/[?#]/)[0];
  const lastSegment = path.split("/").pop() ?? "";
  return lastSegment.includes(".") ? (lastSegment.split(".").pop()?.toLowerCase() ?? "") : "";
}

/** A modern PowerPoint deck — decided by MIME type first, then by the extension of any of the given names/URLs. */
export function isPptxFile(mimeType: string | null | undefined, ...namesOrUrls: (string | null | undefined)[]): boolean {
  if (mimeType === PPTX_MIME_TYPE || mimeType === "application/vnd.google-apps.presentation") return true;
  return namesOrUrls.some((value) => fileExtension(value) === "pptx");
}
