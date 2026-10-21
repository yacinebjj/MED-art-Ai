"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { GlassArt, type GlassArtName } from "@/components/ui/GlassArt";

/**
 * Objects from the "Clinique de Verre" glass family (components/ui/GlassArt.tsx),
 * the same material as the Cockpit header's stethoscope, so the ambient layer
 * and the hero read as one scene. They replace the earlier cartoon sticker
 * sprite (public/illustrations/medical-icons-sprite.png, chroma-keyed by
 * hand, with a green fringe), whose smiling characters clashed with the
 * clinical look of the rest of the page.
 */
interface FloaterSpec {
  art: GlassArtName;
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

// Deliberately sparse (six objects) and scattered toward the edges —
// "subtile", per the original request. Positions avoid the hero/quick-actions
// column that already carries real content.
const FLOATERS: FloaterSpec[] = [
  { art: "neuron", size: 56, top: "2%", right: "4%", delay: 0, duration: 6.5, rotateRange: 6 },
  { art: "molecule", size: 44, top: "18%", right: "16%", delay: 0.8, duration: 7.2, rotateRange: 5 },
  { art: "heart", size: 48, top: "38%", right: "2%", delay: 1.6, duration: 6.8, rotateRange: 7 },
  { art: "dna", size: 52, top: "58%", right: "10%", delay: 0.4, duration: 7.5, rotateRange: 5 },
  { art: "microscope", size: 40, top: "4%", left: "2%", delay: 1.2, duration: 6.2, rotateRange: 6 },
  { art: "capsule", size: 44, bottom: "6%", left: "4%", delay: 0.6, duration: 7.0, rotateRange: 5 },
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
  // `hidden md:block` alone still MOUNTED the infinite framer-motion loops
  // on phones (animating inside a display:none box, every frame). Mounting
  // only on a desktop-class pointer keeps them off the phone's main thread.
  const isDesktop = useMediaQuery("(min-width: 768px) and (hover: hover)");
  const reduceMotion = useReducedMotion();
  if (!isDesktop || reduceMotion) return null;
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
          // Glass is already translucent (the old stickers were opaque), so a
          // slightly higher layer opacity keeps the same faint presence.
          className="absolute opacity-[0.36] dark:opacity-[0.3]"
          style={{ top: floater.top, bottom: floater.bottom, left: floater.left, right: floater.right }}
          animate={{ y: [0, -14, 0], rotate: [0, floater.rotateRange, 0, -floater.rotateRange, 0] }}
          transition={{ duration: floater.duration, delay: floater.delay, repeat: Infinity, ease: "easeInOut" }}
        >
          <GlassArt name={floater.art} size={floater.size} />
        </motion.div>
      ))}
    </div>
  );
}
