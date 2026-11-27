import { AUTH_TIMEOUT_MS } from "@/lib/auth-client";

/**
 * Slow phones: the sign-in form is painted seconds before React takes it over
 * (measured live on 2026-11-27: 3.4 s on a budget Android on 4G, 6.4 s on an
 * old one on 3G). A tap on the button in that gap used to be the browser's own
 * GET submit — /login?email=…&password=… — the password in the address bar,
 * the history and the server logs, `next` dropped, the fields emptied.
 *
 * Now the form is method="post" (nothing ever lands in the URL), and this
 * script — inline, so it runs as soon as it is parsed, long before any bundle —
 * holds the tap: the form gets `data-early` (the button pulses, "Connexion en
 * cours…" shows), and the component sends it the moment it mounts
 * (claimEarlySubmit), with whatever the fields hold by then.
 *
 * Still no React AUTH_TIMEOUT_MS after the tap (a script lost on a bad
 * network): the hold is released with "Connexion lente, réessaie", and the
 * next tap posts natively to AUTH_FORM_POST, which answers with a 303 back to
 * this page — a fresh load, `next` intact, scripts fetched again.
 *
 * Plain ES5. Its only traces are data attributes on the form, which React
 * never manages, so hydration is unaffected. It must be the form's LAST child
 * (it finds the form as its parent). On a client-side navigation React creates
 * the script without running it — React is already there, nothing to hold.
 */
const GUARD_SCRIPT =
  "(function(){var s=document.currentScript,f=s&&s.parentElement;" +
  'if(!f||f.tagName!=="FORM"||f.hasAttribute("data-guard"))return;f.setAttribute("data-guard","");' +
  'f.addEventListener("submit",function(e){if(f.hasAttribute("data-ready")||f.hasAttribute("data-native"))return;' +
  'e.preventDefault();f.removeAttribute("data-slow");f.setAttribute("data-early","");clearTimeout(f.__medartHold);' +
  'f.__medartHold=setTimeout(function(){if(f.hasAttribute("data-ready")||!f.hasAttribute("data-early"))return;' +
  `f.removeAttribute("data-early");f.setAttribute("data-slow","");f.setAttribute("data-native","")},${AUTH_TIMEOUT_MS})})})();`;

export function EarlySubmitGuard() {
  return <script dangerouslySetInnerHTML={{ __html: GUARD_SCRIPT }} />;
}

/**
 * What the student sees while a tap is held (data-early) or after the hold
 * gave up (data-slow). Pure CSS on the form's `group/auth` markers: it shows
 * before any JavaScript, and React only ever renders it hidden.
 */
export function EarlySubmitStatus({ busyLabel, slowLabel }: { busyLabel: string; slowLabel: string }) {
  return (
    <>
      <p role="status" className="hidden pt-3 text-center text-sm text-slate-300 group-data-[early]/auth:block">
        {busyLabel}
      </p>
      <p role="status" className="hidden pt-3 text-center text-sm font-semibold text-amber-300 group-data-[slow]/auth:block">
        {slowLabel}
      </p>
    </>
  );
}

/**
 * React has the form now: the guard steps aside for good (data-ready), and the
 * answer says whether a tap was held for the component to send.
 */
export function claimEarlySubmit(form: HTMLFormElement): boolean {
  const held = form.hasAttribute("data-early");
  form.removeAttribute("data-early");
  form.removeAttribute("data-slow");
  form.removeAttribute("data-native");
  form.setAttribute("data-ready", "");
  return held;
}

/** React handled a submit itself: anything the guard marked as held is this very tap. */
export function dropHeldSubmit(form: HTMLFormElement): void {
  form.removeAttribute("data-early");
}
