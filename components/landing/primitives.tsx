"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { animate, motion, useInView, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Visual building blocks of the landing page. Every effect degrades
 * gracefully: `prefers-reduced-motion` disables tilt / magnetism / particles /
 * counters' animation, and touch devices (no hover) never get pointer effects.
 */

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fade + rise when scrolled into view (once). */
export function Reveal({ children, delay = 0, className, y = 24 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Word-by-word headline reveal. */
export function RevealWords({ text, className, wordClassName, delay = 0 }: { text: string; className?: string; wordClassName?: string; delay?: number }) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="inline-block overflow-hidden pb-[0.12em] align-bottom">
          <motion.span
            className={cn("inline-block", wordClassName)}
            initial={reduce ? false : { y: "110%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{ duration: 0.8, delay: delay + i * 0.06, ease: EASE }}
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

function useCanHover(): boolean {
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    setCanHover(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);
  return canHover;
}

/** 3D tilt that follows the pointer, with a moving specular highlight. */
export function TiltCard({ children, className, max = 10, glare = true }: { children: ReactNode; className?: string; max?: number; glare?: boolean }) {
  const reduce = useReducedMotion();
  const canHover = useCanHover();
  const enabled = canHover && !reduce;
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 180, damping: 18 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 180, damping: 18 });
  const glareX = useTransform(px, [0, 1], ["0%", "100%"]);
  const glareY = useTransform(py, [0, 1], ["0%", "100%"]);
  const glareBg = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.16), transparent 55%)`;

  return (
    <motion.div
      className={cn("relative [transform-style:preserve-3d]", className)}
      style={enabled ? { rotateX, rotateY, transformPerspective: 1100 } : undefined}
      onPointerMove={(e) => {
        if (!enabled) return;
        const rect = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - rect.left) / rect.width);
        py.set((e.clientY - rect.top) / rect.height);
      }}
      onPointerLeave={() => {
        px.set(0.5);
        py.set(0.5);
      }}
    >
      {children}
      {enabled && glare && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glareBg }} />}
    </motion.div>
  );
}

/** Button/link pulled toward the cursor while hovered. */
export function MagneticLink({ href, children, className, strength = 0.35 }: { href: string; children: ReactNode; className?: string; strength?: number }) {
  const reduce = useReducedMotion();
  const canHover = useCanHover();
  const x = useSpring(0, { stiffness: 260, damping: 18 });
  const y = useSpring(0, { stiffness: 260, damping: 18 });
  return (
    <motion.div
      style={{ x, y }}
      className="inline-flex"
      onPointerMove={(e) => {
        if (!canHover || reduce) return;
        const rect = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - rect.left - rect.width / 2) * strength);
        y.set((e.clientY - rect.top - rect.height / 2) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      <Link href={href} className={className}>
        {children}
      </Link>
    </motion.div>
  );
}

/** Large soft light following the cursor across the whole page (desktop only). */
export function CursorGlow() {
  const reduce = useReducedMotion();
  const canHover = useCanHover();
  const x = useSpring(-500, { stiffness: 120, damping: 24 });
  const y = useSpring(-500, { stiffness: 120, damping: 24 });
  useEffect(() => {
    if (!canHover || reduce) return;
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [canHover, reduce, x, y]);
  if (!canHover || reduce) return null;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-0 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.10),rgba(139,92,246,0.06)_40%,transparent_70%)]"
      style={{ x, y }}
    />
  );
}

/**
 * Lightweight canvas particle field ("neurons"): dots drifting with links
 * between close neighbours. ~70 particles, paused when the tab is hidden,
 * disabled for reduced motion.
 */
export function ParticleField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduce) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const count = window.innerWidth < 640 ? 34 : 70;
    const particles = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00035,
      vy: (Math.random() - 0.5) * 0.00035,
      r: Math.random() * 1.4 + 0.4,
    }));
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const tick = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x = (p.x + p.vx + 1) % 1;
        p.y = (p.y + p.vy + 1) % 1;
      }
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        const ax = a.x * width;
        const ay = a.y * height;
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = ax - b.x * width;
          const dy = ay - b.y * height;
          const d2 = dx * dx + dy * dy;
          if (d2 < 120 * 120) {
            ctx.strokeStyle = `rgba(34,211,238,${0.12 * (1 - Math.sqrt(d2) / 120)})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(b.x * width, b.y * height);
            ctx.stroke();
          }
        }
        ctx.fillStyle = "rgba(165,243,252,0.65)";
        ctx.beginPath();
        ctx.arc(ax, ay, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    // Only animate while the canvas is on screen AND the tab is visible.
    let onScreen = true;
    const sync = () => {
      cancelAnimationFrame(raf);
      if (onScreen && document.visibilityState === "visible") raf = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [reduce]);
  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none h-full w-full", className)} />;
}

/** Counts up to `value` when scrolled into view. */
export function NumberTicker({ value, suffix = "", prefix = "", className }: { value: number; suffix?: string; prefix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, { duration: 1.6, ease: EASE, onUpdate: (v) => setDisplay(Math.round(v)) });
    return () => controls.stop();
  }, [inView, value, reduce]);
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, subtitle, className }: { eyebrow: string; title: ReactNode; subtitle?: ReactNode; className?: string }) {
  return (
    <Reveal className={cn("mx-auto max-w-3xl text-center", className)}>
      <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/5 px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
        {eyebrow}
      </span>
      <h2 className="mt-5 text-balance text-3xl font-black tracking-tight text-white sm:text-5xl">{title}</h2>
      {subtitle && <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-slate-400 sm:text-lg">{subtitle}</p>}
    </Reveal>
  );
}

/** Gradient-clipped text. */
export function GradientText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-400 bg-clip-text text-transparent", className)}>{children}</span>;
}

/** Glass panel with a soft glowing border. */
export function GlassPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-3xl border border-white/10 bg-white/[0.035] shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl",
        className
      )}
    >
      {children}
    </div>
  );
}
