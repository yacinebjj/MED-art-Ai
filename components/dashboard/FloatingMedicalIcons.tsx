"use client";

import type { CSSProperties } from "react";
import { motion } from "framer-motion";

/**
 * Source sprite (public/illustrations/medical-icons-sprite.png) — a 12-icon
 * 3D-cartoon medical/AI sticker sheet the user generated and shared on a
 * solid chroma-key green background. Real transparency here (not a CSS
 * blend-mode trick like the earlier Dashboard hero mascot saga) — the green
 * was genuinely removed pixel-by-pixel: loaded into a canvas in the Browser
 * pane, keyed against the exact sampled background color (RGB 27,211,55)
 * with a feathered threshold (soft alpha ramp between a 40 and 90 color-
 * distance band, not a hard cutoff) to avoid a jagged edge from JPEG
 * compression noise, then re-exported as this PNG. A faint green edge
 * fringe remains on a few icons (real chroma-key spill, the same artifact
 * any green-screen footage has without a dedicated spill-suppression pass)
 * — acceptable at the small display size these render at here.
 *
 * 4 columns × 3 rows in the source sheet. The doctor icon (col 0, row 0) is
 * deliberately EXCLUDED below — DashboardHero.tsx already has its own
 * hand-authored SVG doctor mascot; reusing this one too would duplicate the
 * same character right next to it.
 */
const SPRITE_SRC = "/illustrations/medical-icons-sprite.png";
const SPRITE_COLS = 4;
const SPRITE_ROWS = 3;
const SPRITE_ASPECT = 896 / 1195; // height / width of the full sheet

function SpriteIcon({ col, row, size, style }: { col: number; row: number; size: number; style?: CSSProperties }) {
  const cellFraction = 1 / SPRITE_COLS; // each cell is 1/4 of the sheet's width
  const scaledSheetWidth = size * SPRITE_COLS;
  const scaledSheetHeight = scaledSheetWidth * SPRITE_ASPECT;
  const cellHeightFraction = 1 / SPRITE_ROWS;
  return (
    <div
      style={{
        width: size,
        height: scaledSheetHeight * cellHeightFraction,
        backgroundImage: `url(${SPRITE_SRC})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${scaledSheetWidth}px ${scaledSheetHeight}px`,
        backgroundPosition: `${-col * size}px ${-row * scaledSheetHeight * cellHeightFraction}px`,
        ...style,
      }}
    />
  );
}

interface FloaterSpec {
  col: number;
  row: number;
  size: number;
  /** Percentage-based position within the decorative layer, not pixels — keeps the scatter proportional at any viewport width. */
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  /** Stagger + slightly different float rhythm per icon so they never all bob in unison, which would read as one mechanical group instead of ambient scenery. */
  delay: number;
  duration: number;
  rotateRange: number;
}

// Hand-picked, deliberately sparse subset (7 of the 11 non-doctor icons) and
// scattered toward the edges — "subtile", per the request, means most of
// the sheet's icons are left OUT, not that all 11 render faintly. Positions
// avoid the hero/quick-actions column that already carries real content.
const FLOATERS: FloaterSpec[] = [
  { col: 1, row: 0, size: 56, top: "2%", right: "4%", delay: 0, duration: 6.5, rotateRange: 6 }, // brain-AI
  { col: 2, row: 0, size: 44, top: "18%", right: "16%", delay: 0.8, duration: 7.2, rotateRange: 5 }, // MA hexagon
  { col: 3, row: 1, size: 48, top: "38%", right: "2%", delay: 1.6, duration: 6.8, rotateRange: 7 }, // heart-EKG
  { col: 2, row: 1, size: 52, top: "58%", right: "10%", delay: 0.4, duration: 7.5, rotateRange: 5 }, // DNA helix
  { col: 3, row: 0, size: 40, top: "4%", left: "2%", delay: 1.2, duration: 6.2, rotateRange: 6 }, // microscope
  { col: 1, row: 2, size: 44, bottom: "6%", left: "4%", delay: 0.6, duration: 7.0, rotateRange: 5 }, // MA bubble
  { col: 3, row: 2, size: 46, bottom: "2%", right: "6%", delay: 1.0, duration: 6.6, rotateRange: 6 }, // brain+lightbulb
];

/**
 * Ambient decorative layer for the Dashboard home page ONLY (not the shell
 * layout — every other page under app/dashboard/(shell) would get cluttered
 * by icons floating over real work, not just the aurora background this
 * page shows off). `pointer-events-none` throughout: purely visual, never
 * intercepts a click meant for the content in front of it. Desktop-only
 * (`hidden md:block`), same reasoning as DashboardHero's own mascot — a
 * phone's viewport has no room to spare for ambient decoration.
 */
export function FloatingMedicalIcons() {
  return (
    // NOT -z-10 — a NEGATIVE z-index on a child inside a `position:
    // relative` parent (a new stacking context) renders BEHIND that
    // parent's own painted background, not just behind its later
    // siblings' content. Confirmed by direct DOM/screenshot testing: with
    // -z-10, this layer was invisible even at opacity 1, fully hidden
    // behind the parent element's own background paint. Plain DOM order
    // (this component rendered first, before the real content) already
    // puts it behind that later content under normal stacking (z-index:
    // auto) — no negative z-index needed, or wanted.
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block">
      {FLOATERS.map((floater, i) => (
        <motion.div
          key={i}
          className="absolute opacity-[0.24] dark:opacity-[0.2]"
          style={{ top: floater.top, bottom: floater.bottom, left: floater.left, right: floater.right }}
          animate={{ y: [0, -14, 0], rotate: [0, floater.rotateRange, 0, -floater.rotateRange, 0] }}
          transition={{ duration: floater.duration, delay: floater.delay, repeat: Infinity, ease: "easeInOut" }}
        >
          <SpriteIcon col={floater.col} row={floater.row} size={floater.size} />
        </motion.div>
      ))}
    </div>
  );
}
