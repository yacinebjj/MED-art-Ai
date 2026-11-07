"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { useOptionalAuth } from "@/providers/AuthProvider";
import { fetchSyncNamespace, putSyncDoc, putSyncDocNow } from "@/lib/user-sync";
import { captureQuote, locateQuote, spansOverlap, type TextSpan } from "@/lib/reading/anchor-match";
import { buildTextIndex, rangeOfSpan, spanOfRange } from "@/lib/reading/text-index";
import { clearLayer, markedHighlightIds, paintLayer, supportsCustomHighlights, unwrapMarks, wrapRangeInMarks, type HighlightColorId } from "@/lib/reading/highlight-paint";
import { MAX_HIGHLIGHT_CHARS, addHighlight, ensureHighlightsLoaded, getHighlights, newHighlightId, removeHighlights, subscribeHighlights } from "@/lib/reading/highlight-store";
import { READING_POSITION_NS, capturePosition, findScrollContainer, isReadingPosition, readLocalPosition, restorePosition, writeLocalPosition, type ReadingPosition } from "@/lib/reading/scroll-memory";
import { registerReadingSurface, type HighlightAddOutcome } from "@/lib/reading/surface-registry";

/**
 * Makes `element` a READING SURFACE — the one mechanism every reading view
 * of the app uses (Studio sections and Lab tools, the Co-pilot thread, the
 * Résumé de module, exam corrections…), keyed by what is being read
 * (lib/reading/keys.ts):
 *
 *  - HIGHLIGHTS made in it with the selection card (TextSelectionToolbar) are
 *    saved to the student's account (lib/reading/highlight-store.ts) and
 *    painted back every time the content is shown again, wherever the text
 *    now sits (lib/reading/anchor-match.ts) — without touching the DOM React
 *    renders (lib/reading/highlight-paint.ts);
 *  - the READING POSITION is remembered as the student scrolls and restored
 *    when they come back (lib/reading/scroll-memory.ts) — after leaving the
 *    view, closing the app, or on another device.
 *
 * `ready`: false while the content is still a loader / being generated; the
 * position is restored once it turns true.
 */

export const READING_SURFACE_ATTRIBUTE = "data-reading-surface";

interface ReadingSurfaceOptions {
  /** What is being read; null/undefined disables the surface. */
  key: string | null | undefined;
  highlights?: boolean;
  scroll?: boolean;
  ready?: boolean;
}

// Layout effect in the browser (the surface is tagged in the same commit as its content), plain effect on the server.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Position restore keeps re-aligning this long after its first success (late images, diagrams, fonts). */
const RESTORE_SETTLE_MS = 1500;
/** Content that never arrives: stop trying to restore after this. */
const RESTORE_GIVE_UP_MS = 8000;
/** A reading position goes to the account at most this often while scrolling (always on leave). */
const SERVER_SAVE_INTERVAL_MS = 15_000;
const LOCAL_SAVE_DELAY_MS = 250;
const REPAINT_DELAY_MS = 120;
/** A scroll this soon after a wheel/touch/key/pointer is the student's. */
const USER_INTENT_WINDOW_MS = 3000;
/** Momentum scrolling: scroll events keep coming at least this often until it stops. */
const MOMENTUM_GAP_MS = 400;
/** The reading position is measured at most this often while scrolling (never on every frame). */
const CAPTURE_INTERVAL_MS = 150;

export function useReadingSurface(element: HTMLElement | null, { key, highlights = true, scroll = true, ready = true }: ReadingSurfaceOptions): void {
  const auth = useOptionalAuth();
  const userId = auth?.user?.id ?? null;
  const surfaceId = useId();
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const repaintRef = useRef<(() => void) | null>(null);
  const surfaceKey = key || null;

  useIsomorphicLayoutEffect(() => {
    if (!element) return;
    if (surfaceKey) element.setAttribute(READING_SURFACE_ATTRIBUTE, surfaceKey);
    else element.removeAttribute(READING_SURFACE_ATTRIBUTE);
  }, [element, surfaceKey]);

  // ─── highlights ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!element || !surfaceKey || !userId || !highlights) return;
    const apiMode = supportsCustomHighlights();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;

    const paint = () => {
      timer = null;
      if (disposed || !element.isConnected) return;
      const items = getHighlights(userId, surfaceKey);
      if (apiMode) {
        const byColor = new Map<HighlightColorId, Range[]>();
        if (items.length > 0) {
          const index = buildTextIndex(element);
          for (const highlight of items) {
            const span = locateQuote(index.text, highlight);
            const range = span ? rangeOfSpan(index, span.start, span.end) : null;
            if (!range) continue;
            const list = byColor.get(highlight.color);
            if (list) list.push(range);
            else byColor.set(highlight.color, [range]);
          }
        }
        paintLayer(surfaceId, byColor);
        return;
      }
      // <mark> fallback: only on settled content (never while React is still streaming text into it).
      if (!readyRef.current) return;
      const wanted = new Set(items.map((highlight) => highlight.id));
      markedHighlightIds(element).forEach((id) => {
        if (!wanted.has(id)) unwrapMarks(element, id);
      });
      const present = markedHighlightIds(element);
      const index = buildTextIndex(element);
      const toWrap: { range: Range; color: HighlightColorId; id: string }[] = [];
      for (const highlight of items) {
        if (present.has(highlight.id)) continue;
        const span = locateQuote(index.text, highlight);
        const range = span ? rangeOfSpan(index, span.start, span.end) : null;
        if (range) toWrap.push({ range, color: highlight.color, id: highlight.id });
      }
      // Live Ranges follow the text-node splits each wrap makes, so all of them stay valid.
      for (const item of toWrap) wrapRangeInMarks(item.range, item.color, item.id);
      // Our own wraps are not content changes.
      observer?.takeRecords();
    };
    const schedule = (delay = REPAINT_DELAY_MS) => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(paint, delay);
    };
    repaintRef.current = () => schedule(0);

    /** Where each saved highlight sits in the surface's text right now. */
    const locatedSpans = (text: string): { id: string; span: TextSpan }[] =>
      getHighlights(userId, surfaceKey).flatMap((highlight) => {
        const span = locateQuote(text, highlight);
        return span ? [{ id: highlight.id, span }] : [];
      });

    const unregister = registerReadingSurface({
      key: surfaceKey,
      element,
      addHighlight(range: Range, color: HighlightColorId): HighlightAddOutcome {
        const index = buildTextIndex(element);
        const span = spanOfRange(index, range);
        if (!span) return "outside";
        let { start, end } = span;
        while (start < end && /\s/.test(index.text[start])) start++;
        while (end > start && /\s/.test(index.text[end - 1])) end--;
        if (end <= start) return "outside";
        // A highlight over existing ones replaces them with one covering both, in the new colour.
        const replaces: string[] = [];
        for (const { id, span: existing } of locatedSpans(index.text)) {
          if (!spansOverlap(existing, { start, end })) continue;
          replaces.push(id);
          start = Math.min(start, existing.start);
          end = Math.max(end, existing.end);
        }
        if (end - start > MAX_HIGHLIGHT_CHARS) return "too-long";
        const quote = captureQuote(index.text, start, end);
        if (!apiMode) replaces.forEach((id) => unwrapMarks(element, id));
        addHighlight(
          userId,
          surfaceKey,
          { id: newHighlightId(), color, text: quote.text, start: quote.start, end: quote.end, prefix: quote.prefix, suffix: quote.suffix, createdAt: Date.now() },
          replaces
        );
        return "added";
      },
      highlightsIn(range: Range): string[] {
        const index = buildTextIndex(element);
        const span = spanOfRange(index, range);
        if (!span) return [];
        return locatedSpans(index.text)
          .filter((entry) => spansOverlap(entry.span, span))
          .map((entry) => entry.id);
      },
      removeHighlights(ids: string[]): void {
        if (!apiMode) ids.forEach((id) => unwrapMarks(element, id));
        removeHighlights(userId, surfaceKey, ids);
      },
    });

    const unsubscribe = subscribeHighlights(userId, surfaceKey, () => schedule(0));
    ensureHighlightsLoaded(userId, surfaceKey);
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => schedule());
      observer.observe(element, { childList: true, subtree: true, characterData: true });
    }
    schedule(0);

    return () => {
      disposed = true;
      repaintRef.current = null;
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      unsubscribe();
      unregister();
      clearLayer(surfaceId);
    };
  }, [element, surfaceKey, userId, highlights, surfaceId]);

  // Content that just finished loading gets its highlights at once.
  useEffect(() => {
    if (ready) repaintRef.current?.();
  }, [ready]);

  // ─── reading position ──────────────────────────────────────────────────
  useEffect(() => {
    if (!element || !surfaceKey || !userId || !scroll || !ready) return;
    const scroller = findScrollContainer(element);
    const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
    const scrollTarget: HTMLElement | Window = isPage ? window : scroller;

    let disposed = false;
    let wanted: ReadingPosition | null = readLocalPosition(userId, surfaceKey);
    let interacted = false;
    let restoring = wanted !== null;
    let capturing = !restoring;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let localTimer: ReturnType<typeof setTimeout> | null = null;
    let serverTimer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;
    let lastCaptured: ReadingPosition | null = null;
    let lastSent = 0;
    // Only the student's own scrolling is recorded: a pane that jumps because
    // its content was swapped or shrank (a loader, the Zen placeholder) must
    // never overwrite where they really were.
    let lastIntentAt = 0;
    let lastScrollAt = 0;
    let gestureScrolling = false;

    // The surface still shows THIS content (not a view swapped in since).
    const showsThisSurface = () => element.isConnected && element.getAttribute(READING_SURFACE_ATTRIBUTE) === surfaceKey;

    const stopRestoring = () => {
      restoring = false;
      capturing = true;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };
    const giveUpTimer = setTimeout(stopRestoring, RESTORE_GIVE_UP_MS);

    // Re-aligned on every size change of the content (images, diagrams, fonts
    // arriving); stops once it has been still for RESTORE_SETTLE_MS.
    const attemptRestore = () => {
      if (disposed || !restoring || interacted || !wanted || !showsThisSurface()) return;
      if (!restorePosition(element, scroller, wanted)) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(stopRestoring, RESTORE_SETTLE_MS);
    };

    const sendToAccount = (now: boolean) => {
      if (!lastCaptured || lastCaptured.savedAt <= lastSent) return;
      lastSent = lastCaptured.savedAt;
      if (now) putSyncDocNow(READING_POSITION_NS, surfaceKey, lastCaptured);
      else putSyncDoc(READING_POSITION_NS, surfaceKey, lastCaptured, true);
    };

    let lastCaptureAt = 0;
    let trailingTimer: ReturnType<typeof setTimeout> | null = null;
    const capture = () => {
      frame = 0;
      if (disposed || !capturing || !showsThisSurface()) return;
      lastCaptureAt = performance.now();
      const position = capturePosition(element, scroller);
      if (!position) return;
      lastCaptured = position;
      if (!localTimer) {
        localTimer = setTimeout(() => {
          localTimer = null;
          if (lastCaptured) writeLocalPosition(userId, surfaceKey, lastCaptured);
        }, LOCAL_SAVE_DELAY_MS);
      }
      if (!serverTimer) {
        serverTimer = setTimeout(() => {
          serverTimer = null;
          sendToAccount(false);
        }, SERVER_SAVE_INTERVAL_MS);
      }
    };

    const onScroll = () => {
      const now = performance.now();
      // A gesture: right after a wheel/touch/key/pointer, or the momentum scroll that follows it.
      gestureScrolling = now - lastIntentAt < USER_INTENT_WINDOW_MS || (gestureScrolling && now - lastScrollAt < MOMENTUM_GAP_MS);
      lastScrollAt = now;
      if (!gestureScrolling || !capturing || frame || trailingTimer) return;
      // At most one measurement per CAPTURE_INTERVAL_MS while scrolling, and always one after it stops.
      const wait = CAPTURE_INTERVAL_MS - (now - lastCaptureAt);
      if (wait > 0) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          if (!disposed && !frame) frame = requestAnimationFrame(capture);
        }, wait);
        return;
      }
      frame = requestAnimationFrame(capture);
    };
    const onIntent = () => {
      lastIntentAt = performance.now();
      if (interacted) return;
      interacted = true;
      stopRestoring();
    };
    const flushNow = () => {
      if (localTimer) {
        clearTimeout(localTimer);
        localTimer = null;
      }
      if (serverTimer) {
        clearTimeout(serverTimer);
        serverTimer = null;
      }
      if (capturing && showsThisSurface()) {
        const position = capturePosition(element, scroller);
        if (position) lastCaptured = position;
      }
      if (!lastCaptured) return;
      writeLocalPosition(userId, surfaceKey, lastCaptured);
      sendToAccount(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };

    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"] as const) scrollTarget.addEventListener(type, onIntent, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => attemptRestore()) : null;
    resizeObserver?.observe(element);
    if (restoring) frame = requestAnimationFrame(() => {
      frame = 0;
      attemptRestore();
    });

    // The account-wide copy: a place reached on another device more recently wins, if the student has not started scrolling here.
    void fetchSyncNamespace(READING_POSITION_NS, surfaceKey).then((docs) => {
      if (disposed || interacted || !docs) return;
      const doc = docs.find((d) => d.key === surfaceKey && !d.deleted);
      const remote = doc && isReadingPosition(doc.data) ? doc.data : null;
      if (!remote || (wanted && remote.savedAt <= wanted.savedAt + 1000)) return;
      wanted = remote;
      restoring = true;
      capturing = false;
      attemptRestore();
      // Not placeable yet: leave it to the next content resize, or to the give-up timer.
      if (!settleTimer) settleTimer = setTimeout(stopRestoring, RESTORE_GIVE_UP_MS);
    });

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (trailingTimer) clearTimeout(trailingTimer);
      clearTimeout(giveUpTimer);
      if (settleTimer) clearTimeout(settleTimer);
      if (localTimer) clearTimeout(localTimer);
      if (serverTimer) clearTimeout(serverTimer);
      scrollTarget.removeEventListener("scroll", onScroll);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"] as const) scrollTarget.removeEventListener(type, onIntent);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
      resizeObserver?.disconnect();
      // The DOM may already show other content: save what was captured while reading, without measuring again.
      if (lastCaptured) {
        writeLocalPosition(userId, surfaceKey, lastCaptured);
        sendToAccount(false);
      }
    };
  }, [element, surfaceKey, userId, scroll, ready]);
}
