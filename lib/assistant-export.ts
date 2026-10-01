/**
 * "Export to PDF" for one assistant reply, via the browser's own print
 * pipeline ("Save as PDF" is a destination in every print dialog, Android
 * and desktop; iOS offers it from the print preview's share sheet).
 *
 * Deliberately NOT a PDF library: replies are routinely French + Arabic /
 * Darija, and a text-drawing library (jsPDF is in package.json but unused)
 * has no Arabic shaping or bidi — the browser's renderer does. The reply is
 * printed from an isolated hidden frame so the app's own `@media print`
 * rule (app/globals.css blanks the whole app on print) can never apply to it.
 */

const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: #0f172a; background: #fff;
    font: 11.5pt/1.65 "Inter", "Segoe UI", system-ui, -apple-system, "Noto Naskh Arabic", "Noto Sans Arabic", "Arial", sans-serif;
  }
  header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 8pt; margin-bottom: 14pt; border-bottom: 1.5pt solid #10b981; }
  header strong { font-size: 13pt; color: #047857; letter-spacing: .01em; }
  header span { font-size: 9pt; color: #64748b; }
  h1, h2, h3, h4 { color: #0f172a; line-height: 1.25; margin: 1.3em 0 .45em; break-after: avoid; }
  h1 { font-size: 17pt; } h2 { font-size: 14.5pt; } h3 { font-size: 12.5pt; } h4 { font-size: 11.5pt; }
  p { margin: .55em 0; orphans: 3; widows: 3; }
  ul, ol { margin: .5em 0; padding-inline-start: 1.4em; }
  li { margin: .25em 0; }
  strong { color: #0f172a; }
  blockquote { margin: .8em 0; padding: .4em .9em; border-inline-start: 3pt solid #34d399; background: #f0fdf4; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin: .9em 0; font-size: 10.5pt; }
  th, td { border: .75pt solid #cbd5e1; padding: 5pt 7pt; text-align: start; vertical-align: top; }
  thead th { background: #ecfdf5; color: #065f46; }
  tr { break-inside: avoid; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f1f5f9; padding: 8pt 10pt; border-radius: 4pt; font-size: 9.5pt; }
  code { font-family: "Cascadia Code", Consolas, monospace; font-size: .92em; background: #f1f5f9; padding: .1em .3em; border-radius: 3pt; }
  pre code { background: none; padding: 0; }
  a { color: #047857; }
  .stream-word { opacity: 1 !important; animation: none !important; }
  footer { margin-top: 18pt; padding-top: 6pt; border-top: .75pt solid #e2e8f0; font-size: 8.5pt; color: #94a3b8; }
`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function exportReplyToPdf(options: { title: string; html: string; locale?: string }): Promise<void> {
  const locale = options.locale ?? "fr-FR";
  const dateLabel = new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const document_ = `<!doctype html><html lang="${locale.slice(0, 2)}"><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title><style>${PRINT_CSS}</style></head><body><header><strong>MedArt Assistant</strong><span>${escapeHtml(dateLabel)}</span></header><main dir="auto">${options.html}</main><footer>Généré par MedArt AI — contenu d'étude généré par IA, à vérifier avec ton cours. Ne remplace pas un avis médical.</footer></body></html>`;

  return new Promise((resolve, reject) => {
    const frame = window.document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";

    const cleanup = () => window.setTimeout(() => frame.remove(), 1000);

    frame.onload = async () => {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        cleanup();
        reject(new Error("Impossible de préparer le document."));
        return;
      }
      try {
        // Let web fonts (and Arabic fallbacks) settle before the print snapshot.
        await frameWindow.document.fonts?.ready;
        frameWindow.addEventListener("afterprint", cleanup, { once: true });
        frameWindow.focus();
        frameWindow.print();
        // Some browsers never fire afterprint for a cancelled dialog.
        window.setTimeout(cleanup, 120_000);
        resolve();
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error("L'export a échoué."));
      }
    };

    frame.srcdoc = document_;
    window.document.body.appendChild(frame);
  });
}
