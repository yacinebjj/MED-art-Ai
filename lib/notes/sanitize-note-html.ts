/**
 * Cleans note HTML (student-written or produced by "Organiser avec l'IA")
 * before it is injected into the contentEditable editor.
 *
 * Two jobs:
 *  - layout safety: AI output sometimes styles highlights as "pills"
 *    (vertical padding, fixed heights, positioning, floats, negative margins).
 *    On an inline <span>, vertical padding/height overflows into the lines
 *    above and below — the overlapping-badges bug on phones. Only harmless
 *    text styling survives (color, weight, italics, underline, alignment, a
 *    background highlight with horizontal padding at most).
 *  - safety: no scripts, embeds, event handlers or javascript: URLs, since
 *    the result goes through innerHTML.
 *
 * Browser-only (DOMParser); on the server it returns the input unchanged —
 * the editor that renders it is a client component.
 */

const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "SVG", "MATH", "NOSCRIPT", "TEMPLATE"]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-decoration-line",
  "text-align",
  "padding-left",
  "padding-right",
  "border-left",
  "border-left-color",
  "border-left-width",
  "border-left-style",
  "border-radius",
]);

const ALLOWED_ATTRIBUTES = new Set(["style", "href", "colspan", "rowspan", "title", "alt", "src"]);

function cleanStyle(element: HTMLElement): void {
  const style = element.style;
  const kept: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const property = style.item(i);
    if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;
    const value = style.getPropertyValue(property);
    if (/url\(|expression\(/i.test(value)) continue;
    kept.push(`${property}: ${value}`);
  }
  if (kept.length > 0) element.setAttribute("style", kept.join("; "));
  else element.removeAttribute("style");
}

function cleanElement(element: Element): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if ((name === "href" || name === "src") && !/^(https?:|mailto:|#|\/)/i.test(attribute.value.trim())) {
      element.removeAttribute(attribute.name);
    }
  }
  if (element instanceof HTMLElement && element.hasAttribute("style")) cleanStyle(element);
}

export function sanitizeNoteHtml(html: string): string {
  if (!html || typeof window === "undefined" || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toRemove: Element[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as Element;
    if (DROPPED_TAGS.has(element.tagName)) toRemove.push(element);
    else cleanElement(element);
  }
  for (const element of toRemove) element.remove();
  return root.innerHTML;
}
