/**
 * Pinch-zoom shrinks window.visualViewport exactly the way an on-screen
 * keyboard does (height / scale, offsetTop > 0 while panning). Code that
 * reads the visual viewport to follow the keyboard must ignore it while the
 * page is zoomed — otherwise a pinch is taken for "keyboard open", surfaces
 * get resized/padded to the zoomed rectangle, and the layout stays broken
 * after zooming back out.
 */
export function isPinchZoomed(vv: VisualViewport): boolean {
  return Number.isFinite(vv.scale) && vv.scale > 1.01;
}

/** A soft keyboard can only be open while a text field has focus. */
export function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "image", "hidden"].includes(el.type);
  }
  return el instanceof HTMLSelectElement;
}
