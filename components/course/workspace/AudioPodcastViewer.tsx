"use client";

/**
 * Studio's "Podcast Audio" tab content — the "Audio Studio" player for a
 * single ~10-15 min narrated episode (openai/gpt-audio-mini via OpenRouter,
 * cross-student cached — see app/api/studio/podcast/route.ts).
 *
 * A custom UI over a hidden <audio preload="metadata"> element, so the same
 * controls look and behave identically on every browser (the native speed
 * menu is hidden behind a right-click or simply absent depending on the
 * browser — and speed matters for the product's own "en allant à l'hôpital"
 * use case):
 * - seekable waveform (click/drag, hover preview), decoded client-side from
 *   the public Storage URL at a LOW sample rate so a 15-min episode stays a
 *   few dozen MB in memory; any failure (CORS, memory, codec, Save-Data)
 *   falls back to a plain progress bar — playback itself never depends on it;
 * - ±15 s, persisted playback speed, Media Session (lock-screen controls);
 * - "Moments clés": timestamped, optionally labelled bookmarks persisted per
 *   episode in localStorage, also drawn as markers on the waveform;
 * - keyboard: Space play/pause, ←/→ ±5 s, B bookmark — active only once the
 *   student last clicked/focused inside the player, and ignored while a text
 *   field (or a foreign menu/dialog) has focus.
 *
 * There is deliberately no transcript view: the podcast script is not
 * stored anywhere.
 */

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Bookmark, BookmarkPlus, Download, Gauge, Headphones, Pause, Pencil, Play, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

const SPEED_STORAGE_KEY = "medart:podcast-speed";
const BOOKMARKS_STORAGE_PREFIX = "medart:podcast-bookmarks:";

/** Fixed per page load: a stable cache-busting query for the second playback attempt. */
const CACHE_BUST_TOKEN = Date.now().toString(36);

const SKIP_SECONDS = 15;
const ARROW_SEEK_SECONDS = 5;
const WAVEFORM_BARS = 160;
/** Decoding target rate — the waveform only needs coarse amplitude, and 8 kHz keeps a 15-min mono episode around 29 MB of PCM (vs ~350 MB stereo at 48 kHz). */
const WAVEFORM_SAMPLE_RATE = 8000;
/** Beyond this, even a low-rate decode risks memory pressure on phones — fall back to the plain bar. */
const MAX_WAVEFORM_BYTES = 80 * 1024 * 1024;
const MAX_BOOKMARK_LABEL = 80;
/** Pressing B within this many seconds of an existing bookmark edits it instead of creating a near-duplicate. */
const BOOKMARK_DEDUPE_SECONDS = 1;

interface PodcastBookmark {
  id: string;
  time: number;
  label: string;
  createdAt: number;
}

interface WaveformData {
  peaks: number[];
  duration: number;
}

type WaveformState = { status: "loading" } | ({ status: "ready" } & WaveformData) | { status: "unavailable" };

/** Per-page-lifetime memo, keyed by URL — remounting the tab never re-downloads and re-decodes the same episode. */
const waveformCache = new Map<string, WaveformData>();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** cyrb53 — fast, well-distributed, non-cryptographic 53-bit string hash. */
function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Screen-reader friendly form for aria-valuetext ("3 min 12 s"). */
function formatSpokenTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h > 0 ? `${h} h` : null, h > 0 || m > 0 ? `${m} min` : null, `${s} s`].filter(Boolean).join(" ");
}

function formatSpeed(speed: number): string {
  return `${speed.toLocaleString("fr-FR")}×`;
}

function isSpeed(value: number): value is Speed {
  return (SPEED_OPTIONS as readonly number[]).includes(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sortBookmarks(list: PodcastBookmark[]): PodcastBookmark[] {
  return [...list].sort((a, b) => a.time - b.time);
}

function readBookmarks(key: string): PodcastBookmark[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (item): item is PodcastBookmark =>
        !!item &&
        typeof item === "object" &&
        typeof (item as PodcastBookmark).id === "string" &&
        typeof (item as PodcastBookmark).time === "number" &&
        Number.isFinite((item as PodcastBookmark).time) &&
        (item as PodcastBookmark).time >= 0 &&
        typeof (item as PodcastBookmark).label === "string"
    );
    return sortBookmarks(
      valid.map((item) => ({
        id: item.id,
        time: item.time,
        label: item.label.slice(0, MAX_BOOKMARK_LABEL),
        createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : 0,
      }))
    );
  } catch {
    return [];
  }
}

function writeBookmarks(key: string, list: PodcastBookmark[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage unavailable (privacy mode / quota) — bookmarks still work for this visit.
  }
}

/** Respects the student's data-saver preference: the waveform means downloading the whole episode up front. */
function shouldSkipWaveform(): boolean {
  if (typeof navigator === "undefined") return true;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!connection) return false;
  return connection.saveData === true || connection.effectiveType === "slow-2g" || connection.effectiveType === "2g";
}

function createDecodingContext(): BaseAudioContext {
  // An OfflineAudioContext never touches the output device (no interference
  // with the <audio> element's own session on iOS) and resamples on decode.
  if (typeof OfflineAudioContext !== "undefined") {
    try {
      return new OfflineAudioContext(1, 1, WAVEFORM_SAMPLE_RATE);
    } catch {
      // This rate isn't supported here — try a regular AudioContext below.
    }
  }
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== "undefined" ? AudioContext : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio indisponible");
  try {
    return new Ctor({ sampleRate: WAVEFORM_SAMPLE_RATE });
  } catch {
    return new Ctor();
  }
}

/** Covers both the promise form and older Safari's callback-only decodeAudioData. */
function decodeAudio(context: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const maybePromise = context.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolve, reject);
  });
}

/** RMS per bar (reads better than raw peaks for speech, which clips everywhere), normalized and gently curved so quiet passages stay visible. */
function computePeaks(buffer: AudioBuffer, bars: number): number[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const total = buffer.length;
  const blockSize = Math.max(1, Math.floor(total / bars));
  // ~1500 samples per bar per channel is plenty for a stable RMS estimate.
  const stride = Math.max(1, Math.floor(blockSize / 1500));
  const values: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const start = bar * blockSize;
    const end = bar === bars - 1 ? total : Math.min(total, start + blockSize);
    let sumSquares = 0;
    let count = 0;
    for (const data of channels) {
      for (let i = start; i < end; i += stride) {
        const sample = data[i];
        sumSquares += sample * sample;
        count++;
      }
    }
    values.push(count > 0 ? Math.sqrt(sumSquares / count) : 0);
  }
  const max = values.reduce((acc, value) => Math.max(acc, value), 0) || 1;
  return values.map((value) => Math.max(0.06, Math.pow(value / max, 0.8)));
}

async function loadWaveform(audioUrl: string, signal: AbortSignal): Promise<WaveformData> {
  const res = await fetch(audioUrl, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declaredLength = Number(res.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WAVEFORM_BYTES) throw new Error("Fichier trop volumineux pour l'analyse");
  const data = await res.arrayBuffer();
  if (data.byteLength > MAX_WAVEFORM_BYTES) throw new Error("Fichier trop volumineux pour l'analyse");
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const context = createDecodingContext();
  try {
    const audioBuffer = await decodeAudio(context, data);
    return { peaks: computePeaks(audioBuffer, WAVEFORM_BARS), duration: audioBuffer.duration };
  } finally {
    // Only a realtime AudioContext holds an audio device and has close();
    // an OfflineAudioContext is released with its last reference.
    const closable = context as Partial<Pick<AudioContext, "close">>;
    if (typeof closable.close === "function") {
      await closable.close.call(context).catch(() => undefined);
    }
  }
}

// --- Keyboard guards --------------------------------------------------------

function isEditableTarget(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isActivatableTarget(target: Element | null): boolean {
  if (!target) return false;
  return !!target.closest('button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"]');
}

function usesArrowKeys(target: Element | null): boolean {
  if (!target) return false;
  return !!target.closest('[role="slider"], [role="tab"], [role="radio"], [role="menuitem"], [role="option"], [role="listbox"], [role="combobox"], [role="tree"], [role="grid"]');
}

function isInForeignOverlay(target: Element | null, root: HTMLElement): boolean {
  if (!target) return false;
  const overlay = target.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]');
  return !!overlay && !overlay.contains(root);
}

/** A control focused by a mouse click (no visible focus ring) shouldn't swallow Space — the student expects play/pause, like any media player. Keyboard focus keeps native activation. */
function isKeyboardFocused(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true; // selector unsupported — keep native behaviour
  }
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function IconButton({
  label,
  onClick,
  children,
  className,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          whileTap={disabled ? undefined : { scale: 0.9 }}
          className={cn(
            "touch-target relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
            className
          )}
        >
          {children}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SkipButton({ direction, onClick, reduceMotion }: { direction: "back" | "forward"; onClick: () => void; reduceMotion: boolean }) {
  const Icon = direction === "back" ? RotateCcw : RotateCw;
  const label = direction === "back" ? `Reculer de ${SKIP_SECONDS} secondes` : `Avancer de ${SKIP_SECONDS} secondes`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          aria-label={label}
          onClick={onClick}
          whileHover={reduceMotion ? undefined : { scale: 1.06 }}
          whileTap={{ scale: 0.9 }}
          className="relative inline-flex h-12 w-12 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="h-7 w-7" strokeWidth={1.75} />
          <span className="absolute text-[9px] font-bold tabular-nums" aria-hidden>
            {SKIP_SECONDS}
          </span>
        </motion.button>
      </TooltipTrigger>
      <TooltipContent>{direction === "back" ? `−${SKIP_SECONDS} s` : `+${SKIP_SECONDS} s`}</TooltipContent>
    </Tooltip>
  );
}

const WaveformBars = memo(function WaveformBars({ peaks, className }: { peaks: number[]; className: string }) {
  return (
    <g className={className}>
      {peaks.map((peak, i) => {
        const height = Math.max(peak * 92, 3);
        return <rect key={i} x={i + 0.2} y={50 - height / 2} width={0.6} height={height} />;
      })}
    </g>
  );
});

interface BookmarkListProps {
  bookmarks: PodcastBookmark[];
  editing: { id: string; draft: string } | null;
  onJump: (time: number) => void;
  onStartEdit: (bookmark: PodcastBookmark) => void;
  onDraftChange: (draft: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (bookmark: PodcastBookmark) => void;
}

/** Memoized: the player re-renders on every animation frame while playing, this list only when bookmarks/editing change. */
const BookmarkList = memo(function BookmarkList({
  bookmarks,
  editing,
  onJump,
  onStartEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  onDelete,
}: BookmarkListProps) {
  if (bookmarks.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">
        Marque les passages à réécouter : appuie sur « Ajouter »
        <span className="[@media(hover:none)]:hidden"> ou sur la touche B</span> pendant l&apos;écoute.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {bookmarks.map((bookmark) => {
        const isEditing = editing?.id === bookmark.id;
        return (
          <motion.li
            key={bookmark.id}
            layout="position"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-2xl border border-border bg-[color-mix(in_oklab,var(--card)_70%,transparent)] px-2 py-1.5"
          >
            <button
              type="button"
              onClick={() => onJump(bookmark.time)}
              aria-label={`Écouter à partir de ${formatSpokenTime(bookmark.time)}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 text-xs font-semibold tabular-nums text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-primary-500/15 dark:text-primary-300 dark:hover:bg-primary-500/25"
            >
              <Play className="h-3 w-3" />
              {formatTime(bookmark.time)}
            </button>

            {isEditing ? (
              <input
                type="text"
                autoFocus
                value={editing.draft}
                maxLength={MAX_BOOKMARK_LABEL}
                onChange={(event) => onDraftChange(event.target.value)}
                onBlur={onCommitEdit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onCommitEdit();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    onCancelEdit();
                  }
                }}
                placeholder="Note (facultatif) — Entrée pour valider"
                aria-label={`Note du moment clé à ${formatSpokenTime(bookmark.time)}`}
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-[color-mix(in_oklab,var(--background)_80%,transparent)] px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <button
                type="button"
                onClick={() => onJump(bookmark.time)}
                className="min-w-0 flex-1 truncate rounded-lg text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {bookmark.label || <span className="italic text-muted-foreground">Sans titre</span>}
              </button>
            )}

            {!isEditing && (
              <IconButton label="Renommer" onClick={() => onStartEdit(bookmark)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
            )}
            <IconButton label="Supprimer ce moment clé" onClick={() => onDelete(bookmark)} className="hover:text-rose-600 dark:hover:text-rose-400">
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </motion.li>
        );
      })}
    </ul>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Normalizes the stored podcast URL before the browser sees it: trims
 * whitespace, and upgrades an http:// public-storage URL to https:// when
 * the app itself is served over https — the browser silently blocks that
 * mixed-content request, which surfaced as a bare "Lecture impossible".
 */
function normalizeAudioUrl(raw: string): string {
  const url = raw.trim();
  if (typeof window === "undefined") return url;
  const isLocalHost = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
  if (window.location.protocol === "https:" && /^http:\/\//i.test(url) && !isLocalHost) {
    return url.replace(/^http:/i, "https:");
  }
  return url;
}

/**
 * Playback source ladder. A podcast that fails to start is not necessarily
 * broken (a stale CDN entry, a wrong Content-Type from storage, a transient
 * network error all produce the same MediaError), so the player tries, in
 * order: the URL as stored → the same URL with a cache-busting query → the
 * file fetched ourselves and handed to the element as a Blob with a forced
 * audio/mpeg type. Only when all three fail does the error banner show.
 */
type SourceStage = "direct" | "cache-bust" | "blob";

export function AudioPodcastViewer({ audioUrl: storedAudioUrl, courseTitle }: { audioUrl: string; courseTitle: string }) {
  const audioUrl = useMemo(() => normalizeAudioUrl(storedAudioUrl), [storedAudioUrl]);
  const [sourceStage, setSourceStage] = useState<SourceStage>("direct");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobFallbackRunningRef = useRef(false);
  const { toast } = useToast();
  const reduceMotion = useReducedMotion() ?? false;
  const clipId = `podcast-played-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const audioRef = useRef<HTMLAudioElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSourceStage("direct");
    setBlobUrl(null);
    setPlaybackError(false);
    blobFallbackRunningRef.current = false;
  }, [audioUrl]);

  // A blob URL holds the whole file in memory until revoked.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const playbackSrc =
    sourceStage === "blob" && blobUrl ? blobUrl : sourceStage === "cache-bust" ? `${audioUrl}${audioUrl.includes("?") ? "&" : "?"}t=${CACHE_BUST_TOKEN}` : audioUrl;

  const handleMediaError = useCallback(() => {
    setIsPlaying(false);
    setIsBuffering(false);
    if (sourceStage === "direct") {
      setSourceStage("cache-bust");
      return;
    }
    if (sourceStage === "cache-bust" && !blobFallbackRunningRef.current) {
      blobFallbackRunningRef.current = true;
      void (async () => {
        try {
          const res = await fetch(audioUrl, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          if (buffer.byteLength === 0) throw new Error("Fichier vide");
          const declaredType = res.headers.get("Content-Type") ?? "";
          const type = declaredType.startsWith("audio/") ? declaredType : "audio/mpeg";
          setBlobUrl(URL.createObjectURL(new Blob([buffer], { type })));
          setSourceStage("blob");
        } catch {
          setPlaybackError(true);
        } finally {
          blobFallbackRunningRef.current = false;
        }
      })();
      return;
    }
    // Direct, cache-busted and blob sources have all failed.
    if (sourceStage === "blob") setPlaybackError(true);
  }, [sourceStage, audioUrl]);
  const waveRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1);
  const [playbackError, setPlaybackError] = useState(false);
  const [waveform, setWaveform] = useState<WaveformState>(() => {
    const cached = waveformCache.get(audioUrl);
    return cached ? { status: "ready", ...cached } : { status: "loading" };
  });
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);

  // Scoped per account: one podcast file is shared by every student on the
  // same course, so two accounts on one browser must not see each other's bookmarks.
  const { user } = useAuth();
  const bookmarksKey = `${BOOKMARKS_STORAGE_PREFIX}${user?.id ?? "anonymous"}:${hashString(audioUrl)}`;
  const [bookmarks, setBookmarks] = useState<PodcastBookmark[]>([]);
  const [hydratedBookmarksKey, setHydratedBookmarksKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);

  // MP3s without a Xing/VBRI header can report an Infinity/NaN duration —
  // the decoded waveform's own duration is the fallback.
  const duration = mediaDuration > 0 ? mediaDuration : waveform.status === "ready" ? waveform.duration : 0;

  const durationRef = useRef(duration);
  durationRef.current = duration;
  const speedRef = useRef<Speed>(speed);
  speedRef.current = speed;
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const scrubbingRef = useRef(false);

  // --- Playback primitives ----------------------------------------------------

  const updatePositionState = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationRef.current;
    if (!(total > 0)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: total,
        playbackRate: audio.playbackRate || 1,
        position: clamp(audio.currentTime, 0, total),
      });
    } catch {
      // Inconsistent values mid-seek — the next update corrects it.
    }
  }, []);

  const seekTo = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const total = durationRef.current;
      const target = total > 0 ? clamp(time, 0, total) : Math.max(0, time);
      try {
        audio.currentTime = target;
      } catch {
        return; // not seekable yet (no metadata) — leave the position untouched
      }
      setCurrentTime(target);
      updatePositionState();
    },
    [updatePositionState]
  );

  const skipBy = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (audio) seekTo(audio.currentTime + delta);
    },
    [seekTo]
  );

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setPlaybackError(false);
    const attempt = audio.play();
    if (attempt) {
      attempt.catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "AbortError") return; // superseded by a pause/seek — harmless
        setIsPlaying(false);
        // NotAllowedError = the browser wants a user gesture; anything else is a real failure.
        if (name !== "NotAllowedError") setPlaybackError(true);
      });
    }
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused || audio.ended) play();
    else audio.pause();
  }, [play]);

  const jumpTo = useCallback(
    (time: number) => {
      seekTo(time);
      if (audioRef.current?.paused) play();
    },
    [seekTo, play]
  );

  const applySpeed = useCallback(
    (value: Speed) => {
      setSpeed(value);
      const audio = audioRef.current;
      if (audio) {
        audio.defaultPlaybackRate = value;
        audio.playbackRate = value;
      }
      try {
        window.localStorage.setItem(SPEED_STORAGE_KEY, String(value));
      } catch {
        // Not persisted this time — the speed still applies to this session.
      }
      updatePositionState();
    },
    [updatePositionState]
  );

  // Restore the last-used speed (client-only read, avoids a hydration mismatch).
  useEffect(() => {
    let stored: number | null = null;
    try {
      stored = Number(window.localStorage.getItem(SPEED_STORAGE_KEY));
    } catch {
      stored = null;
    }
    if (stored !== null && isSpeed(stored) && stored !== 1) {
      setSpeed(stored);
      const audio = audioRef.current;
      if (audio) {
        audio.defaultPlaybackRate = stored;
        audio.playbackRate = stored;
      }
    }
  }, []);

  // Smooth playhead: the native `timeupdate` only fires ~4×/s.
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let last = -1;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && Math.abs(audio.currentTime - last) >= 0.03) {
        last = audio.currentTime;
        setCurrentTime(last);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [isPlaying]);

  // Never keep playing from a detached element after unmount.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  // --- Waveform ------------------------------------------------------------------

  useEffect(() => {
    const cached = waveformCache.get(audioUrl);
    if (cached) {
      setWaveform({ status: "ready", ...cached });
      return;
    }
    if (shouldSkipWaveform()) {
      setWaveform({ status: "unavailable" });
      return;
    }
    const controller = new AbortController();
    setWaveform({ status: "loading" });
    loadWaveform(audioUrl, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        waveformCache.set(audioUrl, data);
        setWaveform({ status: "ready", ...data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[podcast] Forme d'onde indisponible — barre de progression simple utilisée:", error instanceof Error ? error.message : error);
        setWaveform({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [audioUrl]);

  // --- Bookmarks -------------------------------------------------------------------

  useEffect(() => {
    setBookmarks(readBookmarks(bookmarksKey));
    setEditing(null);
    setHydratedBookmarksKey(bookmarksKey);
  }, [bookmarksKey]);

  useEffect(() => {
    if (hydratedBookmarksKey !== bookmarksKey) return;
    writeBookmarks(bookmarksKey, bookmarks);
  }, [bookmarks, bookmarksKey, hydratedBookmarksKey]);

  const addBookmark = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;
    const nearby = bookmarksRef.current.find((bookmark) => Math.abs(bookmark.time - time) < BOOKMARK_DEDUPE_SECONDS);
    if (nearby) {
      setEditing({ id: nearby.id, draft: nearby.label });
      return;
    }
    const bookmark: PodcastBookmark = { id: createId(), time, label: "", createdAt: Date.now() };
    setBookmarks((previous) => sortBookmarks([...previous, bookmark]));
    setEditing({ id: bookmark.id, draft: "" });
  }, []);

  const startEdit = useCallback((bookmark: PodcastBookmark) => setEditing({ id: bookmark.id, draft: bookmark.label }), []);
  const changeDraft = useCallback((draft: string) => setEditing((current) => (current ? { ...current, draft } : current)), []);
  const cancelEdit = useCallback(() => setEditing(null), []);

  const commitEdit = useCallback(() => {
    const current = editingRef.current;
    if (!current) return;
    const label = current.draft.trim().slice(0, MAX_BOOKMARK_LABEL);
    setBookmarks((previous) => previous.map((bookmark) => (bookmark.id === current.id ? { ...bookmark, label } : bookmark)));
    setEditing(null);
  }, []);

  const deleteBookmark = useCallback(
    (bookmark: PodcastBookmark) => {
      setBookmarks((previous) => previous.filter((item) => item.id !== bookmark.id));
      setEditing((current) => (current?.id === bookmark.id ? null : current));
      toast({
        variant: "info",
        title: "Moment clé supprimé",
        description: bookmark.label ? `« ${bookmark.label} » (${formatTime(bookmark.time)})` : formatTime(bookmark.time),
        action: {
          label: "Annuler",
          onClick: () =>
            setBookmarks((previous) => (previous.some((item) => item.id === bookmark.id) ? previous : sortBookmarks([...previous, bookmark]))),
        },
      });
    },
    [toast]
  );

  // --- Media Session (lock screen / headset controls) -------------------------------

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const mediaSession = navigator.mediaSession;
    try {
      if (typeof MediaMetadata !== "undefined") {
        mediaSession.metadata = new MediaMetadata({
          title: courseTitle,
          artist: "MedArt AI",
          album: "Podcast MedArt AI",
          artwork: [
            { src: `${window.location.origin}/icon-192.png`, sizes: "192x192", type: "image/png" },
            { src: `${window.location.origin}/icon-512.png`, sizes: "512x512", type: "image/png" },
          ],
        });
      }
    } catch {
      // Metadata unsupported — controls below still work.
    }

    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => play()],
      ["pause", () => audioRef.current?.pause()],
      ["seekbackward", (details) => skipBy(-(details.seekOffset ?? SKIP_SECONDS))],
      ["seekforward", (details) => skipBy(details.seekOffset ?? SKIP_SECONDS)],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") seekTo(details.seekTime);
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // This browser doesn't support this action — skip it.
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Same as above.
        }
      }
      try {
        mediaSession.metadata = null;
        mediaSession.playbackState = "none";
      } catch {
        // Best-effort cleanup.
      }
    };
  }, [courseTitle, play, seekTo, skipBy]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      // Older implementations expose playbackState read-only.
    }
  }, [isPlaying]);

  // --- Keyboard ------------------------------------------------------------------------

  // The shortcuts listen on window, so without this they'd fire for keys
  // pressed anywhere on the page whenever focus sits on <body> or another
  // scroll container (Space scrolling the chat would toggle playback). They
  // only act once the student has last clicked or focused INSIDE the player;
  // a click or focus anywhere else disengages them.
  const isEngagedRef = useRef(false);
  useEffect(() => {
    const track = (event: Event) => {
      const root = rootRef.current;
      isEngagedRef.current = !!root && event.target instanceof Node && root.contains(event.target);
    };
    document.addEventListener("pointerdown", track, true);
    document.addEventListener("focusin", track, true);
    return () => {
      document.removeEventListener("pointerdown", track, true);
      document.removeEventListener("focusin", track, true);
    };
  }, []);

  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (!isEngagedRef.current) return;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const root = rootRef.current;
    if (!root || root.getClientRects().length === 0) return; // hidden tab
    const target = event.target instanceof Element ? event.target : null;
    if (isEditableTarget(target) || isInForeignOverlay(target, root)) return;
    const inPlayer = !!target && root.contains(target);

    if (event.key === " ") {
      if (target && isActivatableTarget(target) && (!inPlayer || isKeyboardFocused(target))) return;
      event.preventDefault();
      if (!event.repeat) togglePlay();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (!inPlayer && usesArrowKeys(target)) return;
      event.preventDefault();
      skipBy(event.key === "ArrowLeft" ? -ARROW_SEEK_SECONDS : ARROW_SEEK_SECONDS);
      return;
    }
    if ((event.key === "b" || event.key === "B") && !event.repeat) {
      event.preventDefault();
      addBookmark();
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // --- Seek bar interactions -------------------------------------------------------

  function ratioFromClientX(clientX: number): number {
    const element = waveRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!(durationRef.current > 0)) return;
    if (event.pointerType === "mouse") {
      // No text selection while dragging — but keep the slider focusable
      // (preventDefault also suppresses the mousedown that would focus it).
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbingRef.current = true;
    const ratio = ratioFromClientX(event.clientX);
    setScrubRatio(ratio);
    setHoverRatio(ratio);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const ratio = ratioFromClientX(event.clientX);
    if (scrubbingRef.current) {
      setScrubRatio(ratio);
      setHoverRatio(ratio);
    } else if (event.pointerType !== "touch") {
      setHoverRatio(ratio);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    // Seeks once on release rather than on every move — a remote MP3 would
    // otherwise fire a range request per pointermove.
    seekTo(ratioFromClientX(event.clientX) * durationRef.current);
    setScrubRatio(null);
    if (event.pointerType === "touch") setHoverRatio(null);
  }

  function handlePointerCancel() {
    scrubbingRef.current = false;
    setScrubRatio(null);
    setHoverRatio(null);
  }

  function handlePointerLeave() {
    if (!scrubbingRef.current) setHoverRatio(null);
  }

  function handleSliderKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const total = durationRef.current;
    const audio = audioRef.current;
    if (!audio || !(total > 0)) return;
    const steps: Record<string, number | "start" | "end"> = {
      ArrowLeft: -ARROW_SEEK_SECONDS,
      ArrowDown: -ARROW_SEEK_SECONDS,
      ArrowRight: ARROW_SEEK_SECONDS,
      ArrowUp: ARROW_SEEK_SECONDS,
      PageDown: -SKIP_SECONDS * 2,
      PageUp: SKIP_SECONDS * 2,
      Home: "start",
      End: "end",
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    if (step === "start") seekTo(0);
    else if (step === "end") seekTo(total);
    else seekTo(audio.currentTime + step);
  }

  // --- Derived ---------------------------------------------------------------------

  const progressRatio = scrubRatio ?? (duration > 0 ? clamp(currentTime / duration, 0, 1) : 0);
  const displayedTime = scrubRatio !== null ? scrubRatio * duration : currentTime;
  const markers = useMemo(
    () => (duration > 0 ? bookmarks.filter((bookmark) => bookmark.time <= duration).map((bookmark) => ({ ...bookmark, ratio: bookmark.time / duration })) : []),
    [bookmarks, duration]
  );
  const downloadName = `podcast-${courseTitle.replace(/[^a-zA-Z0-9-_]/g, "_")}.mp3`;
  // The `download` attribute is ignored for cross-origin URLs (the Supabase
  // public Storage URL), so a plain link would navigate away from the
  // workspace to the raw MP3. Supabase's own `download` query parameter makes
  // the server answer with Content-Disposition: attachment instead.
  const downloadHref = `${audioUrl}${audioUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(downloadName)}`;

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <audio
        ref={audioRef}
        src={playbackSrc}
        preload="metadata"
        className="hidden"
        onPlay={() => {
          setIsPlaying(true);
          updatePositionState();
        }}
        onPause={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          const audio = audioRef.current;
          if (audio) setCurrentTime(audio.currentTime);
          updatePositionState();
        }}
        onEnded={() => {
          setIsPlaying(false);
          setIsBuffering(false);
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          // Some browsers reset playbackRate when (re)loading the source.
          audio.defaultPlaybackRate = speedRef.current;
          audio.playbackRate = speedRef.current;
          if (Number.isFinite(audio.duration) && audio.duration > 0) setMediaDuration(audio.duration);
          setPlaybackError(false);
          updatePositionState();
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setMediaDuration(value);
        }}
        onTimeUpdate={(event) => {
          if (!isPlaying) setCurrentTime(event.currentTarget.currentTime);
        }}
        onSeeked={updatePositionState}
        onRateChange={updatePositionState}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onError={handleMediaError}
      />

      <section className="glass-card flex flex-col gap-4 rounded-3xl p-4 shadow-glass dark:shadow-glass-dark sm:p-5" aria-label="Lecteur du podcast">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300">
            <Headphones className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">Audio Studio</p>
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground" title={courseTitle}>
              {courseTitle}
            </h3>
          </div>
          {duration > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
              {formatTime(duration)}
            </span>
          )}
        </div>

        {/* Seek area: bookmark markers + waveform (or plain bar) */}
        <div className="flex flex-col gap-1">
          <div className="relative h-4" aria-hidden={markers.length === 0}>
            {markers.map((marker) => (
              <Tooltip key={marker.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => jumpTo(marker.time)}
                    aria-label={`Moment clé ${marker.label ? `« ${marker.label} » ` : ""}à ${formatSpokenTime(marker.time)}`}
                    style={{ left: `${marker.ratio * 100}%` }}
                    className="touch-target absolute top-0 flex h-4 w-4 -translate-x-1/2 items-start justify-center text-amber-500 transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400"
                  >
                    <Bookmark className="h-3.5 w-3.5 fill-current" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {formatTime(marker.time)}
                  {marker.label ? ` — ${marker.label}` : ""}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          <div
            ref={waveRef}
            role="slider"
            tabIndex={0}
            aria-label="Position de lecture"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(displayedTime)}
            aria-valuetext={`${formatSpokenTime(displayedTime)} sur ${formatSpokenTime(duration)}`}
            aria-disabled={duration > 0 ? undefined : true}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerLeave}
            onKeyDown={handleSliderKeyDown}
            className={cn(
              "relative h-16 w-full select-none rounded-xl [touch-action:pan-y] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              duration > 0 ? "cursor-pointer" : "cursor-default"
            )}
          >
            {waveform.status === "ready" ? (
              <svg viewBox={`0 0 ${WAVEFORM_BARS} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                <defs>
                  <clipPath id={clipId}>
                    <rect x={0} y={0} width={progressRatio * WAVEFORM_BARS} height={100} />
                  </clipPath>
                </defs>
                <WaveformBars peaks={waveform.peaks} className="fill-slate-300 dark:fill-slate-600" />
                <g clipPath={`url(#${clipId})`}>
                  <WaveformBars peaks={waveform.peaks} className="fill-primary-500 dark:fill-primary-400" />
                </g>
              </svg>
            ) : (
              <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted">
                <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-400" style={{ width: `${progressRatio * 100}%` }} />
                <div
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-600 shadow-soft dark:border-slate-900 dark:bg-primary-400"
                  style={{ left: `${progressRatio * 100}%` }}
                />
              </div>
            )}

            {/* Bookmark guide lines */}
            {markers.map((marker) => (
              <span
                key={marker.id}
                aria-hidden
                className="pointer-events-none absolute inset-y-1 w-px bg-amber-400/70 dark:bg-amber-300/60"
                style={{ left: `${marker.ratio * 100}%` }}
              />
            ))}

            {/* Playhead */}
            {waveform.status === "ready" && duration > 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-primary-700 dark:bg-primary-300"
                style={{ left: `${progressRatio * 100}%` }}
              />
            )}

            {/* Hover / scrub preview */}
            {hoverRatio !== null && duration > 0 && (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-px bg-[color-mix(in_oklab,var(--foreground)_40%,transparent)]"
                  style={{ left: `${hoverRatio * 100}%` }}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-soft dark:bg-slate-100 dark:text-slate-900"
                  style={{ left: `${clamp(hoverRatio, 0.04, 0.96) * 100}%` }}
                >
                  {formatTime(hoverRatio * duration)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center justify-between text-xs font-medium tabular-nums text-muted-foreground">
            <span>{formatTime(displayedTime)}</span>
            {waveform.status === "loading" && <span className="text-[11px] text-[color-mix(in_oklab,var(--muted-foreground)_80%,transparent)]">Analyse de la forme d&apos;onde…</span>}
            <span>{duration > 0 ? formatTime(duration) : "--:--"}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-center gap-4">
          <SkipButton direction="back" onClick={() => skipBy(-SKIP_SECONDS)} reduceMotion={reduceMotion} />
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Lecture"}
                aria-keyshortcuts="Space"
                whileHover={reduceMotion ? undefined : { scale: 1.05 }}
                whileTap={{ scale: 0.92 }}
                className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-white shadow-glow transition-colors hover:bg-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-primary-500 dark:hover:bg-primary-400"
              >
                {isPlaying && isBuffering && (
                  <span aria-hidden className="absolute inset-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
                {isPlaying ? <Pause className="h-7 w-7 fill-current" /> : <Play className="ml-1 h-7 w-7 fill-current" />}
              </motion.button>
            </TooltipTrigger>
            <TooltipContent>{isPlaying ? "Pause (Espace)" : "Lecture (Espace)"}</TooltipContent>
          </Tooltip>
          <SkipButton direction="forward" onClick={() => skipBy(SKIP_SECONDS)} reduceMotion={reduceMotion} />
        </div>

        {playbackError && (
          <div role="alert" className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Lecture impossible : le fichier audio n&apos;a pas pu être chargé.
            <button
              type="button"
              onClick={() => {
                // Start the whole ladder again — the failure may have been transient.
                setPlaybackError(false);
                blobFallbackRunningRef.current = false;
                setBlobUrl(null);
                setSourceStage("direct");
                audioRef.current?.load();
              }}
              className="rounded-lg px-2 py-0.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Réessayer
            </button>
          </div>
        )}

        {/* Speed */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            Vitesse
          </span>
          <div role="group" aria-label="Vitesse de lecture" className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-soft">
            {SPEED_OPTIONS.map((option) => {
              const active = speed === option;
              return (
                <motion.button
                  key={option}
                  type="button"
                  onClick={() => applySpeed(option)}
                  aria-pressed={active}
                  whileTap={{ scale: 0.92 }}
                  className={cn(
                    "min-h-8 rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-primary-600 text-white shadow-glow dark:bg-primary-500" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {formatSpeed(option)}
                </motion.button>
              );
            })}
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground [@media(hover:none)]:hidden">
          Espace : lecture/pause · ← / → : ±{ARROW_SEEK_SECONDS} s · B : moment clé
        </p>
      </section>

      {/* Moments clés */}
      <section className="glass-card flex flex-col gap-3 rounded-3xl p-4 shadow-glass dark:shadow-glass-dark" aria-label="Moments clés">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            <h4 className="text-sm font-semibold text-foreground">Moments clés</h4>
            {bookmarks.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{bookmarks.length}</span>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                type="button"
                onClick={addBookmark}
                aria-keyshortcuts="B"
                whileHover={reduceMotion ? undefined : { y: -1 }}
                whileTap={{ scale: 0.95 }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                Ajouter à {formatTime(currentTime)}
              </motion.button>
            </TooltipTrigger>
            <TooltipContent>Marquer ce moment (B)</TooltipContent>
          </Tooltip>
        </div>

        <BookmarkList
          bookmarks={bookmarks}
          editing={editing}
          onJump={jumpTo}
          onStartEdit={startEdit}
          onDraftChange={changeDraft}
          onCommitEdit={commitEdit}
          onCancelEdit={cancelEdit}
          onDelete={deleteBookmark}
        />
        <p className="text-[11px] text-muted-foreground">Enregistrés sur cet appareil.</p>
      </section>

      <div className="flex justify-center">
        {/* target="_blank" is a safety net: if the attachment header were ever missing, the file opens in a new tab instead of replacing the workspace. */}
        <a
          href={downloadHref}
          download={downloadName}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-glow dark:bg-primary-500 dark:hover:bg-primary-400"
        >
          <Download className="h-4 w-4" />
          Télécharger le podcast
        </a>
      </div>
    </div>
  );
}
