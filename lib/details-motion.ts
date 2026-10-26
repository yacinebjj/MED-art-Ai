import { EASE_EXIT, EASE_GLIDE } from "@/lib/motion";

/**
 * Every native <details> in the app unfolds and folds back instead of
 * snapping, on every browser. CSS can only animate a disclosure's height
 * where `interpolate-size` exists (not Safari), so the summary's toggle is
 * taken over here: the same element, the same `open` attribute and `toggle`
 * event, the same mouse and keyboard behavior — only the height animates
 * (Web Animations API). The content's own fade is CSS (the `details` rules
 * in app/globals.css). A <details data-motion="native"> keeps the browser's
 * instant toggle.
 *
 * Installed once by providers/RouteMotionProvider.tsx; returns its uninstaller.
 */

const OPEN_MS = 420;
const CLOSE_MS = 300;

const running = new WeakMap<HTMLDetailsElement, Animation>();

// Height of the closed box: the summary plus the element's own padding and borders.
function closedHeight(details: HTMLDetailsElement, summary: HTMLElement): number {
  const style = getComputedStyle(details);
  const chrome =
    (parseFloat(style.paddingTop) || 0) +
    (parseFloat(style.paddingBottom) || 0) +
    (parseFloat(style.borderTopWidth) || 0) +
    (parseFloat(style.borderBottomWidth) || 0);
  return summary.offsetHeight + chrome;
}

function track(details: HTMLDetailsElement, animation: Animation, onDone: () => void) {
  running.set(details, animation);
  animation.onfinish = () => {
    running.delete(details);
    onDone();
    delete details.dataset.closing;
    details.style.overflow = "";
  };
}

function toggle(details: HTMLDetailsElement, summary: HTMLElement) {
  // Read before cancelling: mid-animation, this is where the box is now.
  const startHeight = details.offsetHeight;
  running.get(details)?.cancel();
  running.delete(details);
  details.style.overflow = "hidden";

  if (details.open && details.dataset.closing !== "true") {
    details.dataset.closing = "true";
    const animation = details.animate(
      { height: [`${startHeight}px`, `${closedHeight(details, summary)}px`] },
      { duration: CLOSE_MS, easing: EASE_EXIT }
    );
    track(details, animation, () => {
      details.open = false;
    });
    return;
  }

  // Opening — or reopening a box that was still folding away.
  delete details.dataset.closing;
  details.open = true;
  const endHeight = details.offsetHeight;
  const animation = details.animate({ height: [`${startHeight}px`, `${endHeight}px`] }, { duration: OPEN_MS, easing: EASE_GLIDE });
  track(details, animation, () => {});
}

function handleClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;
  const summary = target?.closest("summary");
  if (!target || !(summary instanceof HTMLElement)) return;
  const details = summary.parentElement;
  if (!(details instanceof HTMLDetailsElement) || details.querySelector(":scope > summary") !== summary) return;
  if (details.dataset.motion === "native" || typeof details.animate !== "function") return;
  // A control inside the summary (a button, a link) keeps its own behavior.
  const control = target.closest("a, button, input, select, textarea, label");
  if (control && control !== summary && summary.contains(control)) return;
  event.preventDefault();
  toggle(details, summary);
}

export function installDetailsMotion(): () => void {
  document.addEventListener("click", handleClick);
  return () => document.removeEventListener("click", handleClick);
}
