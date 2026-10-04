"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Download, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { formatClock } from "@/lib/lecture-transcript";
import { CHUNK_SECONDS } from "@/lib/audio/browser-chunking";
import { cn } from "@/lib/utils";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const;
/** WAV chunks written by the pipeline: 16 kHz mono 16-bit → 32 000 bytes per second after the 44-byte header. */
const WAV_BYTES_PER_SECOND = 32_000;

export type PlayerSource = { kind: "file"; file: File } | { kind: "segments"; urls: string[] };

export interface StudioAudioPlayerHandle {
  seekTo: (seconds: number, autoplay?: boolean) => void;
}

interface Segment {
  url: string;
  duration: number;
}

/** Waveform bars on a canvas; click/drag to seek inside the represented span. */
function Waveform({ peaks, ratio, onSeekRatio, loading }: { peaks: number[] | null; ratio: number; onSeekRatio: (r: number) => void; loading: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const height = 72;
    canvas.width = Math.round(width * dpr);
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const barWidth = 3;
    const gap = 2;
    const count = Math.max(1, Math.floor(width / (barWidth + gap)));
    const playedX = ratio * width;
    for (let i = 0; i < count; i++) {
      const source = peaks && peaks.length > 0 ? peaks[Math.floor((i / count) * peaks.length)] ?? 0 : 0.12 + 0.08 * Math.sin(i * 0.7);
      const h = Math.max(3, source * (height - 8));
      const x = i * (barWidth + gap);
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      if (x <= playedX) {
        gradient.addColorStop(0, "#fb7185");
        gradient.addColorStop(1, "#f43f5e");
      } else {
        gradient.addColorStop(0, "rgba(148,163,184,0.55)");
        gradient.addColorStop(1, "rgba(148,163,184,0.3)");
      }
      ctx.fillStyle = gradient;
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(x, (height - h) / 2, barWidth, h, 1.5);
        ctx.fill();
      } else {
        ctx.fillRect(x, (height - h) / 2, barWidth, h);
      }
    }
  }, [peaks, ratio, width]);

  function ratioFromEvent(clientX: number) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  return (
    <div
      ref={wrapRef}
      className={cn("relative h-[72px] w-full cursor-pointer touch-none select-none", loading && "animate-pulse")}
      onPointerDown={(e) => {
        draggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onSeekRatio(ratioFromEvent(e.clientX));
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) onSeekRatio(ratioFromEvent(e.clientX));
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      role="slider"
      aria-label="Forme d'onde — cliquer pour se déplacer"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}

function decodePeaks(arrayBuffer: ArrayBuffer, bars = 360): Promise<number[]> {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return Promise.resolve([]);
  const ctx = new Ctor();
  return ctx
    .decodeAudioData(arrayBuffer)
    .then((buffer) => {
      const data = buffer.getChannelData(0);
      const block = Math.max(1, Math.floor(data.length / bars));
      const out: number[] = [];
      let max = 0;
      for (let b = 0; b < bars; b++) {
        let peak = 0;
        for (let i = b * block; i < Math.min(data.length, (b + 1) * block); i += 8) peak = Math.max(peak, Math.abs(data[i]));
        out.push(peak);
        max = Math.max(max, peak);
      }
      return max > 0 ? out.map((p) => p / max) : out;
    })
    .finally(() => void ctx.close?.());
}

/**
 * Lecture player for the Audio Studio: one continuous timeline across the
 * recording's 4-minute storage segments (or a local file before upload),
 * canvas waveform, 0.75×–2.5×, ±10 s, precise scrub bar and a volume boost
 * up to 300 % (Web Audio gain) for quiet amphitheatre recordings.
 * `seekTo` lets the transcript jump to a timestamp.
 */
export const StudioAudioPlayer = forwardRef<StudioAudioPlayerHandle, { source: PlayerSource; peaks?: number[] | null; title: string; onTime?: (seconds: number) => void; onDuration?: (seconds: number) => void }>(
  function StudioAudioPlayer({ source, peaks: providedPeaks, title, onTime, onDuration }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [segments, setSegments] = useState<Segment[]>([]);
    const [active, setActive] = useState(0);
    const [activeSrc, setActiveSrc] = useState<string | null>(null);
    const [segmentPeaks, setSegmentPeaks] = useState<number[] | null>(null);
    const [loadingSegment, setLoadingSegment] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [localTime, setLocalTime] = useState(0);
    const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
    const [volume, setVolume] = useState(1); // 0..3 (above 1 = Web Audio boost)
    const pendingSeekRef = useRef<{ offset: number; play: boolean } | null>(null);
    const graphRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
    const blobUrlsRef = useRef<string[]>([]);
    const onTimeRef = useRef(onTime);
    onTimeRef.current = onTime;

    // ── Build the segment list ─────────────────────────────────────────
    useEffect(() => {
      let cancelled = false;
      setActive(0);
      setLocalTime(0);
      if (source.kind === "file") {
        const url = URL.createObjectURL(source.file);
        setSegments([{ url, duration: 0 }]);
        setActiveSrc(url);
        return () => {
          cancelled = true;
          URL.revokeObjectURL(url);
        };
      }
      setSegments(source.urls.map((url) => ({ url, duration: CHUNK_SECONDS })));
      // Exact durations from the WAV sizes (HEAD only, no download).
      void Promise.all(
        source.urls.map(async (url) => {
          try {
            const res = await fetch(url, { method: "HEAD" });
            const length = Number(res.headers.get("content-length"));
            return res.ok && length > 44 ? (length - 44) / WAV_BYTES_PER_SECOND : null;
          } catch {
            return null;
          }
        })
      ).then((durations) => {
        if (cancelled) return;
        setSegments(source.urls.map((url, i) => ({ url, duration: durations[i] ?? CHUNK_SECONDS })));
      });
      return () => {
        cancelled = true;
      };
    }, [source]);

    // ── Load the active saved segment as a blob (waveform + same-origin playback for the boost) ──
    useEffect(() => {
      if (source.kind !== "segments") return;
      const url = source.urls[active];
      if (!url) return;
      let cancelled = false;
      setLoadingSegment(true);
      setSegmentPeaks(null);
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.arrayBuffer();
        })
        .then(async (buffer) => {
          if (cancelled) return;
          const blobUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
          blobUrlsRef.current.push(blobUrl);
          setActiveSrc(blobUrl);
          const peaks = await decodePeaks(buffer.slice(0));
          if (!cancelled) setSegmentPeaks(peaks);
        })
        .catch(() => {
          // Storage refused a cross-origin fetch: stream the URL directly (no waveform for this segment).
          if (!cancelled) setActiveSrc(url);
        })
        .finally(() => {
          if (!cancelled) setLoadingSegment(false);
        });
      return () => {
        cancelled = true;
      };
    }, [source, active]);

    useEffect(
      () => () => {
        blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        void graphRef.current?.ctx.close();
      },
      []
    );

    const offsets = useMemo(() => {
      const out: number[] = [];
      let acc = 0;
      for (const seg of segments) {
        out.push(acc);
        acc += seg.duration;
      }
      return { starts: out, total: acc };
    }, [segments]);

    const globalTime = (offsets.starts[active] ?? 0) + localTime;
    const total = offsets.total;

    const onDurationRef = useRef(onDuration);
    onDurationRef.current = onDuration;
    useEffect(() => {
      if (total > 0) onDurationRef.current?.(total);
    }, [total]);

    const seekGlobal = useCallback(
      (seconds: number, play?: boolean) => {
        const audio = audioRef.current;
        if (!audio || segments.length === 0) return;
        const t = Math.max(0, Math.min(seconds, Math.max(0, offsets.total - 0.05)));
        let idx = 0;
        while (idx < segments.length - 1 && t >= offsets.starts[idx + 1]) idx++;
        const offset = t - offsets.starts[idx];
        const shouldPlay = play ?? !audio.paused;
        if (idx === active) {
          audio.currentTime = offset;
          setLocalTime(offset);
          if (shouldPlay) void audio.play().catch(() => undefined);
        } else {
          pendingSeekRef.current = { offset, play: shouldPlay };
          setActive(idx);
        }
      },
      [segments, offsets, active]
    );

    useImperativeHandle(ref, () => ({ seekTo: (seconds, autoplay = true) => seekGlobal(seconds, autoplay) }), [seekGlobal]);

    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (volume > 1 && !graphRef.current) {
        const src = audio.currentSrc || audio.src;
        // Web Audio on a cross-origin stream without CORS would mute it — only boost same-origin (blob:) sources.
        if (src.startsWith("blob:")) {
          try {
            const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (Ctor) {
              const ctx = new Ctor();
              const gain = ctx.createGain();
              ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
              graphRef.current = { ctx, gain };
              // The slider move is the user gesture: resume now so playback in progress never goes silent.
              void ctx.resume();
            }
          } catch {
            graphRef.current = null;
          }
        }
      }
      audio.volume = Math.min(1, volume);
      if (graphRef.current) graphRef.current.gain.gain.value = Math.max(1, volume);
    }, [volume, activeSrc]);

    useEffect(() => {
      if (audioRef.current) audioRef.current.playbackRate = speed;
    }, [speed, activeSrc]);

    function togglePlay() {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) {
        void graphRef.current?.ctx.resume();
        void audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    }

    const boostAvailable = (activeSrc ?? "").startsWith("blob:");
    const waveformPeaks = source.kind === "file" ? providedPeaks ?? null : segmentPeaks;
    const waveRatio =
      source.kind === "file" ? (total > 0 ? globalTime / total : 0) : (segments[active]?.duration ?? 0) > 0 ? localTime / segments[active].duration : 0;

    return (
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-4 text-white shadow-[0_24px_60px_-28px_rgba(244,63,94,0.55)]">
        <audio
          ref={audioRef}
          src={activeSrc ?? undefined}
          preload="metadata"
          onLoadedMetadata={(e) => {
            const audio = e.currentTarget;
            audio.playbackRate = speed;
            // The loaded media's own duration is authoritative (the HEAD-based value is an estimate).
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
              setSegments((segs) => (segs[active] && Math.abs(segs[active].duration - audio.duration) > 0.05 ? segs.map((seg, i) => (i === active ? { ...seg, duration: audio.duration } : seg)) : segs));
            }
            const pending = pendingSeekRef.current;
            if (pending) {
              pendingSeekRef.current = null;
              audio.currentTime = pending.offset;
              setLocalTime(pending.offset);
              if (pending.play) void audio.play().catch(() => undefined);
            }
          }}
          onTimeUpdate={(e) => {
            setLocalTime(e.currentTarget.currentTime);
            onTimeRef.current?.((offsets.starts[active] ?? 0) + e.currentTarget.currentTime);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            if (active < segments.length - 1) {
              pendingSeekRef.current = { offset: 0, play: true };
              setActive(active + 1);
            } else {
              setPlaying(false);
            }
          }}
          className="hidden"
        />

        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.14em] text-rose-200/80">
          <span className="truncate">{title}</span>
          {source.kind === "segments" && segments.length > 1 && (
            <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 tabular-nums text-white/70">
              Segment {active + 1}/{segments.length}
            </span>
          )}
        </div>

        <Waveform
          peaks={waveformPeaks}
          ratio={waveRatio}
          loading={loadingSegment}
          onSeekRatio={(r) => {
            if (source.kind === "file") seekGlobal(r * total);
            else seekGlobal((offsets.starts[active] ?? 0) + r * (segments[active]?.duration ?? 0));
          }}
        />

        {/* Global precision scrub bar across the whole recording */}
        <div className="mt-2 flex items-center gap-3">
          <span className="w-14 text-right font-mono text-xs tabular-nums text-white/80">{formatClock(globalTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, total)}
            step={0.1}
            value={Math.min(globalTime, total)}
            onChange={(e) => seekGlobal(Number(e.target.value))}
            aria-label="Position dans l'enregistrement"
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-rose-500"
          />
          <span className="w-14 font-mono text-xs tabular-nums text-white/60">{formatClock(total)}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => seekGlobal(globalTime - 10)} aria-label="Reculer de 10 secondes" className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 active:scale-90">
              <RotateCcw className="h-4 w-4" />
              <span className="absolute -bottom-0.5 text-[8px] font-black">10</span>
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Lecture"}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-rose-600 shadow-[0_8px_24px_-6px_rgba(244,63,94,0.8)] transition hover:scale-105 active:scale-95"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
            </button>
            <button type="button" onClick={() => seekGlobal(globalTime + 10)} aria-label="Avancer de 10 secondes" className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 active:scale-90">
              <RotateCw className="h-4 w-4" />
              <span className="absolute -bottom-0.5 text-[8px] font-black">10</span>
            </button>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto rounded-full bg-white/[0.07] p-1 [scrollbar-width:none]" role="radiogroup" aria-label="Vitesse de lecture">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={speed === s}
                onClick={() => setSpeed(s)}
                className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-bold tabular-nums transition", speed === s ? "bg-rose-500 text-white" : "text-white/60 hover:text-white")}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setVolume((v) => (v === 0 ? 1 : 0))} aria-label={volume === 0 ? "Rétablir le son" : "Couper le son"} className="text-white/70 hover:text-white">
              {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={boostAvailable ? 3 : 1}
              step={0.05}
              value={Math.min(volume, boostAvailable ? 3 : 1)}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume (au-delà de 100 % : amplification)"
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/15 accent-rose-400"
            />
            <span className={cn("w-11 text-right text-[11px] font-bold tabular-nums", volume > 1 ? "text-amber-300" : "text-white/60")}>{Math.round(volume * 100)}%</span>
            {source.kind === "segments" && activeSrc && (
              <a href={activeSrc} download={`${title.replace(/[^a-zA-Z0-9-_]/g, "_")}-segment-${active + 1}.wav`} aria-label="Télécharger ce segment" className="text-white/60 hover:text-white">
                <Download className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }
);
