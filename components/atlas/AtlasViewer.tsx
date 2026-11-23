"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronDown, ExternalLink, LayoutGrid, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ATLASES, atlasMedallion, atlasStandalonePage, type AtlasEntry } from "./atlas-catalog";
import { AtlasMissingError, loadAtlasDocument } from "./atlas-loader";
import { atlasHand } from "./atlas-fonts";
import { HandText } from "./HandText";
import styles from "./atlas-zoom.module.css";

/*
 * Full-screen studio for one atlas. The atlas page (public/atlas-zoom/<slug>/atlas.txt) runs in an
 * <iframe srcdoc>: same origin as the app, so it loads its plates from /atlas-zoom/ under the app's
 * own CSP (a src= iframe would need frame-src 'self', which next.config.mjs does not grant).
 * A small bridge injected in every atlas talks to this component with postMessage:
 *   atlas → hub  hello · ready · state {title, level, mag, index, count} · mag {mag} · fullscreen · blur · focus
 *   hub → atlas  inset {top} (room for this bar on narrow screens) · goto {index} (open on a plate)
 */

type Phase = "loading" | "ready" | "missing" | "error" | "blocked";

interface LiveState {
  slug: string;
  title: string;
  level: string;
  mag: string;
  index: number;
  count: number;
}

type AtlasMessage =
  | { source: "medart-atlas"; type: "hello" | "ready" | "fullscreen" | "blur" | "focus" }
  | { source: "medart-atlas"; type: "state"; title?: unknown; level?: unknown; mag?: unknown; index?: unknown; count?: unknown }
  | { source: "medart-atlas"; type: "mag"; mag?: unknown }
  | { source: "medart-atlas"; type: "busy"; on?: unknown };

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };

/** No "hello" from the atlas by then: inline scripts were refused, offer the full-page version. */
const HELLO_TIMEOUT_MS = 8000;
/** The atlas said hello but its first plate is slow: show it anyway (it has its own loader). */
const READY_TIMEOUT_MS = 15000;
/** Below this width the bar spans the screen and the atlas moves its scale panel under it. */
const NARROW_MAX_PX = 899;

const MENU_GROUPS: { label: string; pick: (atlas: AtlasEntry) => boolean }[] = [
  { label: "Atlas vedette", pick: (atlas) => Boolean(atlas.featured) },
  { label: "Thorax", pick: (atlas) => !atlas.featured && atlas.category === "thorax" },
  { label: "Digestif", pick: (atlas) => !atlas.featured && atlas.category === "digestif" },
  { label: "Génital", pick: (atlas) => !atlas.featured && atlas.category === "genital" },
  { label: "Neuro", pick: (atlas) => !atlas.featured && atlas.category === "neuro" },
  { label: "Locomoteur", pick: (atlas) => !atlas.featured && atlas.category === "locomoteur" },
];

const asText = (value: unknown) => (typeof value === "string" ? value.slice(0, 240) : "");
const asIndex = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : -1);

function isAtlasMessage(data: unknown): data is AtlasMessage {
  return typeof data === "object" && data !== null && (data as { source?: unknown }).source === "medart-atlas" && typeof (data as { type?: unknown }).type === "string";
}

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as WebkitDocument).webkitFullscreenElement ?? null;
}

function exitFullscreen() {
  if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => undefined);
    return;
  }
  (document as WebkitDocument).webkitExitFullscreen?.();
}

function enterFullscreen(element: WebkitElement) {
  if (element.requestFullscreen) {
    element.requestFullscreen().catch(() => undefined);
    return;
  }
  element.webkitRequestFullscreen?.();
}

interface AtlasViewerProps {
  atlas: AtlasEntry;
  /** 0-based plate to open on (?planche=), or null for the atlas' own start. */
  plate: number | null;
  onClose: () => void;
  onSwitch: (slug: string) => void;
}

export function AtlasViewer({ atlas, plate, onClose, onSwitch }: AtlasViewerProps) {
  const slug = atlas.slug;
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const helloRef = useRef(false);
  const readyRef = useRef(false);
  const relayingRef = useRef(false);
  const relayedBlurRef = useRef(false);
  const pendingPlateRef = useRef<number | null>(null);

  const [mounted, setMounted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [doc, setDoc] = useState<{ slug: string; html: string } | null>(null);
  const [status, setStatus] = useState<{ slug: string; phase: Phase }>({ slug, phase: "loading" });
  const [live, setLive] = useState<LiveState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);

  // Everything below is keyed by slug, so switching organ never shows the previous one for a frame.
  const phase: Phase = status.slug === slug ? status.phase : "loading";
  const liveNow = live && live.slug === slug ? live : null;
  const html = doc && doc.slug === slug ? doc.html : null;
  const known = atlas.number > 0;
  const art = known ? `url(${atlasMedallion(slug)})` : undefined;

  // ── open: claim the screen, remember fullscreen support
  useEffect(() => {
    setMounted(true);
    const root = document.documentElement;
    root.classList.add("az-viewer-open");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const webkitDocument = document as WebkitDocument;
    setCanFullscreen(Boolean(document.fullscreenEnabled || webkitDocument.webkitFullscreenEnabled));
    return () => {
      root.classList.remove("az-viewer-open");
      document.body.style.overflow = previousOverflow;
      if (fullscreenElement()) exitFullscreen();
    };
  }, []);

  // Focus starts on "Retour" (the portal exists from the second render on).
  useEffect(() => {
    if (mounted) backRef.current?.focus({ preventScroll: true });
  }, [mounted]);

  // The app behind the studio is fully covered: its decorative loops (halo, glows, floating icons)
  // hold still meanwhile, so the GPU only works for the atlas. They resume on close.
  useEffect(() => {
    if (!mounted) return;
    const root = rootRef.current;
    const held = document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return animation.playState === "running" && !!target && !(root && root.contains(target));
    });
    held.forEach((animation) => animation.pause());
    return () =>
      held.forEach((animation) => {
        try {
          if (animation.playState === "paused") animation.play();
        } catch {
          // An animation whose element left the page meanwhile has nothing to resume.
        }
      });
  }, [mounted]);

  // ── load the atlas page (instant when the medallion was hovered first)
  useEffect(() => {
    let cancelled = false;
    helloRef.current = false;
    readyRef.current = false;
    setMenuOpen(false);
    setQuiet(false);
    if (!atlas.available) {
      setStatus({ slug, phase: "missing" });
      return;
    }
    setStatus({ slug, phase: "loading" });
    loadAtlasDocument(slug).then(
      (text) => {
        if (!cancelled) setDoc({ slug, html: text });
      },
      (error: unknown) => {
        if (!cancelled) setStatus({ slug, phase: error instanceof AtlasMissingError ? "missing" : "error" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [slug, atlas.available, attempt]);

  // ── a plate to open on: sent once the atlas is ready (or right away if it already is)
  const post = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ source: "medart-hub", ...message }, window.location.origin);
  }, []);

  useEffect(() => {
    pendingPlateRef.current = plate;
    if (readyRef.current && plate != null) {
      post({ type: "goto", index: plate });
      pendingPlateRef.current = null;
    }
  }, [slug, plate, attempt, post]);

  // ── room for this bar: on narrow screens the atlas slides its scale panel below it
  const sendInset = useCallback(() => {
    const bar = barRef.current;
    if (!bar || !helloRef.current) return;
    const top = window.innerWidth <= NARROW_MAX_PX ? Math.round(bar.getBoundingClientRect().bottom + 6) : 0;
    post({ type: "inset", top });
  }, [post]);

  useEffect(() => {
    window.addEventListener("resize", sendInset);
    return () => window.removeEventListener("resize", sendInset);
  }, [sendInset]);

  // ── fullscreen of the whole studio (bar included), from the button or the atlas' F key
  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current as WebkitElement | null;
    if (!root) return;
    if (fullscreenElement()) exitFullscreen();
    else enterFullscreen(root);
  }, []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(fullscreenElement()));
      window.setTimeout(sendInset, 60);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [sendInset]);

  // ── the app's anti-leak SecurityGuard (hooks/useSecurityGuard.ts, mounted at the root) blurs the
  // whole screen 300 ms after this window loses focus — and focus moving INTO the atlas frame fires
  // exactly that, on every click in the atlas. Once focus has settled in our frame (a tick after the
  // event), the guard's pending blur is cancelled the way it cancels itself: a window "focus".
  // The atlas reports its own real focus changes (blur / focus messages), relayed to the guard, so
  // leaving the app while an atlas is open still blurs the screen exactly as everywhere else.
  const relay = useCallback((type: "blur" | "focus") => {
    relayingRef.current = true;
    try {
      window.dispatchEvent(new FocusEvent(type));
    } finally {
      relayingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const focusInFrame = () => frameRef.current !== null && document.activeElement === frameRef.current;
    function onWindowBlur(event: FocusEvent) {
      if (event.target !== window || relayingRef.current) return;
      const check = (again: boolean) => {
        if (focusInFrame()) {
          setMenuOpen(false);
          relay("focus");
        } else if (again) {
          timers.push(window.setTimeout(() => check(false), 60));
        }
      };
      timers.push(window.setTimeout(() => check(true), 0));
    }
    function onWindowFocus(event: FocusEvent) {
      if (event.target === window && !relayingRef.current) relayedBlurRef.current = false;
    }
    window.addEventListener("blur", onWindowBlur, true);
    window.addEventListener("focus", onWindowFocus, true);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("blur", onWindowBlur, true);
      window.removeEventListener("focus", onWindowFocus, true);
    };
  }, [relay]);

  // ── messages from the atlas (only from our own frame, only same-origin)
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (!isAtlasMessage(data)) return;
      switch (data.type) {
        case "hello":
          helloRef.current = true;
          sendInset();
          break;
        case "ready":
          if (readyRef.current) break;
          readyRef.current = true;
          setStatus({ slug, phase: "ready" });
          if (pendingPlateRef.current != null) {
            post({ type: "goto", index: pendingPlateRef.current });
            pendingPlateRef.current = null;
          }
          // Keyboard straight to the atlas (arrows, +/-), unless the student is already elsewhere.
          if (document.activeElement === backRef.current || document.activeElement === document.body) frame.focus();
          break;
        case "state":
          setLive({ slug, title: asText(data.title), level: asText(data.level), mag: asText(data.mag), index: asIndex(data.index), count: asIndex(data.count) });
          break;
        case "mag": {
          const mag = asText(data.mag);
          setLive((previous) => (previous && previous.slug === slug ? { ...previous, mag } : previous));
          break;
        }
        case "fullscreen":
          toggleFullscreen();
          break;
        case "busy":
          setQuiet(data.on === true);
          break;
        case "blur":
          // Focus left the atlas: for the page (the bar) or for another app? Only the latter is a real loss.
          window.setTimeout(() => {
            if (!document.hasFocus() && !relayedBlurRef.current) {
              relayedBlurRef.current = true;
              relay("blur");
            }
          }, 0);
          break;
        case "focus":
          if (relayedBlurRef.current) {
            relayedBlurRef.current = false;
            relay("focus");
          }
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [slug, post, relay, sendInset, toggleFullscreen]);

  // ── watchdogs: never leave the student on a spinner
  useEffect(() => {
    if (!html) return;
    const hello = window.setTimeout(() => {
      if (!helloRef.current) setStatus((current) => (current.slug === slug && current.phase === "loading" ? { slug, phase: "blocked" } : current));
    }, HELLO_TIMEOUT_MS);
    const ready = window.setTimeout(() => {
      if (helloRef.current) setStatus((current) => (current.slug === slug && current.phase === "loading" ? { slug, phase: "ready" } : current));
    }, READY_TIMEOUT_MS);
    return () => {
      window.clearTimeout(hello);
      window.clearTimeout(ready);
    };
  }, [html, slug, attempt]);

  // ── keyboard (when focus is in the bar, not in the atlas) and the switcher menu
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (menuOpen) {
        setMenuOpen(false);
        switcherRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        return;
      }
      if (!fullscreenElement()) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, onClose]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    // A tap inside the atlas never reaches this document, but it does blur this window.
    const onBlur = () => setMenuOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onBlur);
    switcherRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [menuOpen]);

  const pick = (next: string) => {
    setMenuOpen(false);
    if (next !== slug) onSwitch(next);
  };

  if (!mounted) return null;

  const isTronc = liveNow ? liveNow.level.includes("/") : false;
  const position = liveNow && liveNow.index >= 0 && liveNow.count > 0 ? `${liveNow.index + 1}/${liveNow.count}` : "";
  const deskSub = liveNow?.title ? (isTronc || !position ? liveNow.title : `${position} · ${liveNow.title}`) : atlas.tagline;
  const phoneSub = liveNow ? [liveNow.mag, liveNow.level, isTronc ? "" : position].filter(Boolean).join(" · ") : atlas.scale;
  const showNotice = phase === "missing" || phase === "error" || phase === "blocked";

  return createPortal(
    <div
      ref={rootRef}
      className={cn(styles.viewer, styles.tone)}
      data-cat={atlas.category}
      role="dialog"
      aria-modal="true"
      aria-label={`Atlas Zoom — ${atlas.name}`}
    >
      {html && !showNotice && (
        <iframe
          key={`${slug}:${attempt}`}
          ref={frameRef}
          className={styles.frame}
          data-ready={phase === "ready"}
          title={`Atlas zoomable — ${atlas.name}`}
          srcDoc={html}
        />
      )}

      <div className={styles.loading} data-done={phase === "ready"} aria-hidden={phase === "ready"}>
        {showNotice ? (
          <div className={styles.notice} role="alert">
            <div className={styles.loadOrb}>
              <span className={styles.loadImg} style={{ backgroundImage: art }} />
            </div>
            {phase === "missing" && (
              <>
                <p className={cn(atlasHand.className, styles.noticeTitle)}>Bientôt disponible</p>
                <p className={styles.noticeText}>
                  {known ? `L’atlas « ${atlas.name} » arrive très bientôt dans l’Atlas Zoom.` : "Cet atlas arrive très bientôt dans l’Atlas Zoom."} En attendant, explore les autres organes.
                </p>
                <div className={styles.noticeActions}>
                  <button type="button" className={cn(styles.noticeBtn, styles.noticeBtnPrimary)} onClick={() => setMenuOpen(true)}>
                    <LayoutGrid className="h-4 w-4" /> Choisir un autre organe
                  </button>
                  <button type="button" className={styles.noticeBtn} onClick={onClose}>
                    Retour
                  </button>
                </div>
              </>
            )}
            {phase === "error" && (
              <>
                <p className={cn(atlasHand.className, styles.noticeTitle)}>Connexion interrompue</p>
                <p className={styles.noticeText}>L’atlas n’a pas pu être chargé. Vérifie ta connexion, puis réessaie.</p>
                <div className={styles.noticeActions}>
                  <button type="button" className={cn(styles.noticeBtn, styles.noticeBtnPrimary)} onClick={() => setAttempt((value) => value + 1)}>
                    <RotateCcw className="h-4 w-4" /> Réessayer
                  </button>
                  <button type="button" className={styles.noticeBtn} onClick={onClose}>
                    Retour
                  </button>
                </div>
              </>
            )}
            {phase === "blocked" && (
              <>
                <p className={cn(atlasHand.className, styles.noticeTitle)}>Ouvre l’atlas en pleine page</p>
                <p className={styles.noticeText}>Ton navigateur n’a pas pu lancer l’atlas ici. En pleine page, tout fonctionne de la même façon.</p>
                <div className={styles.noticeActions}>
                  <a className={cn(styles.noticeBtn, styles.noticeBtnPrimary)} href={atlasStandalonePage(slug, plate)}>
                    <ExternalLink className="h-4 w-4" /> Ouvrir en pleine page
                  </a>
                  <button type="button" className={styles.noticeBtn} onClick={() => setAttempt((value) => value + 1)}>
                    <RotateCcw className="h-4 w-4" /> Réessayer
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div>
            <div className={styles.loadOrb}>
              <span className={styles.loadImg} style={{ backgroundImage: art }} />
            </div>
            <p className={cn(atlasHand.className, styles.loadName)}>
              <HandText text={atlas.name} />
            </p>
            <p className={styles.loadHint}>
              Préparation de l’atlas · {atlas.plates.length} planches · {atlas.pins} repères
            </p>
          </div>
        )}
      </div>

      <div ref={barRef} className={styles.bar} data-quiet={quiet && !menuOpen && phase === "ready"}>
        <button ref={backRef} type="button" className={styles.barBtn} onClick={onClose} aria-label="Retour à l’Atlas Zoom">
          <ArrowLeft aria-hidden />
          <span className={styles.barBtnLabel}>Retour</span>
        </button>

        <div className={styles.barId}>
          <span className={styles.barThumb} style={{ backgroundImage: art }} aria-hidden />
          <div className={styles.barText}>
            <p className={cn(atlasHand.className, styles.barName)}>
              <HandText text={atlas.name} />
            </p>
            <p className={cn(styles.barSub, styles.barSubDesk)}>{deskSub}</p>
            <p className={cn(styles.barSub, styles.barSubPhone)}>{phoneSub}</p>
          </div>
        </div>

        {(liveNow?.mag || atlas.scale) && (
          <span className={styles.badge}>
            <b>{liveNow?.mag || atlas.scale}</b>
            {liveNow?.level && <small>{liveNow.level}</small>}
          </span>
        )}

        <div ref={switcherRef} className={styles.switcher}>
          <button type="button" className={styles.barBtn} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Changer d’organe" onClick={() => setMenuOpen((open) => !open)}>
            <LayoutGrid aria-hidden />
            <span className={styles.barBtnLabel}>Organes</span>
            <ChevronDown aria-hidden className={cn("transition-transform duration-200", menuOpen && "rotate-180", "max-sm:hidden")} />
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu" aria-label="Atlas Zoom — organes">
              {MENU_GROUPS.map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <p className={styles.menuGroup} aria-hidden>
                    {group.label}
                  </p>
                  {ATLASES.filter(group.pick).map((entry) => (
                    <button
                      key={entry.slug}
                      type="button"
                      role="menuitem"
                      className={cn(styles.menuItem, styles.tone)}
                      data-cat={entry.category}
                      aria-current={entry.slug === slug ? "true" : undefined}
                      onClick={() => pick(entry.slug)}
                    >
                      <span className={styles.menuThumb} style={{ backgroundImage: `url(${atlasMedallion(entry.slug)})` }} aria-hidden />
                      <span className={styles.menuName}>{entry.name}</span>
                      <span className={styles.menuNum}>{entry.available ? String(entry.number).padStart(2, "0") : "Bientôt"}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {canFullscreen && (
          <button type="button" className={styles.barBtn} onClick={toggleFullscreen} aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"} title="Plein écran (F)">
            {isFullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            <span className={cn(styles.barBtnLabel, styles.barBtnLabelWide)}>{isFullscreen ? "Quitter" : "Plein écran"}</span>
          </button>
        )}
      </div>

      <p className={styles.srOnly} aria-live="polite">
        {liveNow?.title ?? ""}
      </p>
    </div>,
    document.body
  );
}
