"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ProgressRingProps {
  completed: number;
  total: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Rendered in the ring's center — defaults to a plain "{pct}%" when omitted. Ignored when showLabel is false. */
  label?: React.ReactNode;
  /** Small inline rings (section headers) render just the arc, no center text — set false to skip it entirely. */
  showLabel?: boolean;
}

/**
 * completed/total only ever comes from real task counts the caller already
 * has in hand — this component never invents a value, and deliberately
 * renders nothing (not even an empty track) when total is 0, so a section
 * with zero tasks never shows a fake 0/0 or fake 100% ring.
 */
export function ProgressRing({ completed, total, size = 48, strokeWidth = 5, className, label, showLabel = true }: ProgressRingProps) {
  const gradientId = useId();
  if (total <= 0) return null;

  const pct = Math.round((completed / total) * 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  const isDone = pct >= 100;

  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
        <defs>
          {/* Same from-primary/to-violet-500 (in progress) and from-emerald-500/to-primary
              (done) pairing this file's own linear progress bar already used before this
              redesign — reused verbatim as SVG stops so the ring introduces zero new colors. */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            {isDone ? (
              <>
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="var(--primary)" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="var(--primary)" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </>
            )}
          </linearGradient>
        </defs>
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex items-center justify-center text-center leading-none">
          {label ?? <span className="text-xs font-bold text-foreground">{pct}%</span>}
        </div>
      )}
    </div>
  );
}
