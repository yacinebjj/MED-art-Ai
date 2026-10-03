"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  /** Horizontal pointer movement in px since the last call — the caller decides the sign (a left pane grows with +dx, a right pane with −dx). */
  onResize: (deltaPx: number) => void;
  onReset: () => void;
  label: string;
  valueNow: number;
  valueMin: number;
  valueMax: number;
  /** Which direction "ArrowRight" should grow the pane: 1 for a left-hand pane, −1 for a right-hand one. */
  keyboardDirection: 1 | -1;
}

/**
 * Draggable vertical splitter between two workspace panes — pointer capture
 * (so a fast drag never "drops" the handle), keyboard support (←/→ by 16 px,
 * Shift for 64 px, Home resets) and double-click to reset. Exposed as an ARIA
 * `separator` with its current value, per the WAI-ARIA window-splitter pattern.
 */
export function ResizeHandle({ onResize, onReset, label, valueNow, valueMin, valueMax, keyboardDirection }: ResizeHandleProps) {
  const lastXRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    lastXRef.current = e.clientX;
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (lastXRef.current === null) return;
    const delta = e.clientX - lastXRef.current;
    if (delta === 0) return;
    lastXRef.current = e.clientX;
    onResize(delta);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (lastXRef.current === null) return;
    lastXRef.current = null;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowRight") onResize(step * keyboardDirection);
    else if (e.key === "ArrowLeft") onResize(-step * keyboardDirection);
    else if (e.key === "Home" || e.key === "Enter") onReset();
    else return;
    e.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      title={`${label} — glisse pour redimensionner, double-clic pour réinitialiser`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className="group relative z-10 -mx-1.5 flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none"
    >
      <span
        aria-hidden
        className={cn(
          "h-full w-px rounded-full bg-transparent transition-all duration-200 group-hover:w-[3px] group-hover:bg-primary-400/60 group-focus-visible:w-[3px] group-focus-visible:bg-primary-500",
          isDragging && "w-[3px] bg-primary-500 shadow-[0_0_12px_rgb(20_184_166/0.7)]"
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 flex h-8 w-1.5 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full bg-border opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
          isDragging && "opacity-100 bg-primary-500"
        )}
      />
    </div>
  );
}
