"use client";

import { useEffect, useRef } from "react";

interface AudioWaveformProps {
  /** The REAL live mic stream currently being recorded — null renders an inert flat line, never a fake animation pretending to react to sound that isn't there. */
  stream: MediaStream | null;
  className?: string;
  barCount?: number;
}

/**
 * Real-time waveform driven by an AnalyserNode reading the ACTUAL live
 * recording stream (Web Audio API, no server round-trip) — every bar's
 * height is a genuine frequency-bin amplitude sampled right now, not a
 * decorative loop. Canvas (not SVG/DOM bars) specifically because this
 * redraws on every animation frame while recording; SVG/DOM node churn at
 * that rate would be needlessly expensive for something purely visual.
 */
export function AudioWaveform({ stream, className, barCount = 40 }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    function resize() {
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = Math.max(1, Math.round(rect.width * dpr));
      canvas!.height = Math.max(1, Math.round(rect.height * dpr));
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // Idle bars — a calm, non-reactive baseline so a student sees a real
    // waveform SHAPE even for the one frame before the stream connects, and
    // permanently once recording stops (stream becomes null) instead of a
    // blank canvas.
    function drawIdle() {
      if (!canvas || !ctx) return;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const barWidth = width / barCount;
      ctx.fillStyle = "currentColor";
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < barCount; i++) {
        const barHeight = height * 0.08;
        ctx.fillRect(i * barWidth + barWidth * 0.2, (height - barHeight) / 2, barWidth * 0.6, barHeight);
      }
    }

    if (!stream) {
      drawIdle();
      return () => resizeObserver.disconnect();
    }

    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioContextCtor();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    // Only the lower half of the spectrum carries real speech energy — the
    // upper bins stay near-silent for a voice recording and would just draw
    // a row of flat bars, wasting half the visible width on nothing.
    const usableBins = Math.floor(analyser.frequencyBinCount * 0.6);
    const step = Math.max(1, Math.floor(usableBins / barCount));

    let rafId: number;
    function draw() {
      rafId = requestAnimationFrame(draw);
      if (!canvas || !ctx) return;
      analyser.getByteFrequencyData(frequencyData);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const barWidth = width / barCount;

      for (let i = 0; i < barCount; i++) {
        const value = frequencyData[i * step] / 255;
        const barHeight = Math.max(height * 0.08, value * height);
        const x = i * barWidth;
        const y = (height - barHeight) / 2;
        ctx.fillStyle = "currentColor";
        ctx.globalAlpha = 0.55 + value * 0.45;
        ctx.fillRect(x + barWidth * 0.2, y, barWidth * 0.6, barHeight);
      }
    }
    draw();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      source.disconnect();
      analyser.disconnect();
      void audioCtx.close();
    };
  }, [stream, barCount]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
