/**
 * Short vibration tick for taps that deserve physical feedback (send, copy,
 * arming a quick action). Android browsers honor it; iOS Safari does not
 * implement the Vibration API at all, so there it is a silent no-op — never
 * an error, never something the UI depends on.
 *
 * Chrome ignores vibrate() until the user has interacted with the page and
 * logs a console error each time it is called earlier than that, so the call
 * is skipped until `navigator.userActivation` reports a real tap.
 */
export function haptic(pattern: number | number[] = 8): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate(pattern);
  } catch {
    // Some embedded webviews throw on vibrate() — feedback is optional, ignore.
  }
}
