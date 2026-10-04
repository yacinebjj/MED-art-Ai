/** Client-side export helpers for the Audio Studio (no server round trip, nothing uploaded). */

export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "smart-notes";
}

export function downloadText(fileName: string, text: string, mime = "text/markdown;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prints an already-rendered element (the Smart Notes) to PDF through the
 * browser's own print dialog: the app's stylesheets are cloned into a clean
 * light-themed window so the medical boxes and tables keep their design.
 * Returns false when the browser blocked the pop-up.
 */
export function printElementAsPdf(element: HTMLElement, title: string): boolean {
  const win = window.open("", "_blank", "width=900,height=1100");
  if (!win) return false;
  const styles = Array.from(document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style'))
    .map((node) => node.outerHTML)
    .join("\n");
  const escapedTitle = title.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);
  win.document.open();
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapedTitle}</title>${styles}
<style>
  @page { margin: 16mm 14mm; }
  html, body { background: #fff !important; color: #1e293b; }
  body { font-family: var(--font-inter), system-ui, sans-serif; font-size: 13.5px; padding: 0; margin: 0; }
  .print-wrap { max-width: 760px; margin: 0 auto; padding: 24px 8px; }
  .print-title { font-size: 26px; font-weight: 800; margin: 0 0 4px; color: #0f172a; }
  .print-meta { font-size: 11px; color: #64748b; margin-bottom: 18px; letter-spacing: .08em; text-transform: uppercase; }
  aside, table, tr, h2, h3 { break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body><div class="print-wrap"><h1 class="print-title">${escapedTitle}</h1><p class="print-meta">MedArt · Audio to Smart Notes</p>${element.innerHTML}</div></body></html>`);
  win.document.close();
  const trigger = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === "complete") setTimeout(trigger, 400);
  else win.addEventListener("load", () => setTimeout(trigger, 250));
  return true;
}
