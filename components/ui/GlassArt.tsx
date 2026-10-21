import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * "Clinique de Verre" illustrations (public/art/glass/*.webp): single 3D
 * objects in translucent teal glass, one visual family for the whole app.
 * Generated once with OpenAI GPT Image 2.5 with a REAL transparent
 * background (every file has a true alpha channel — not a white box, not a
 * painted checkerboard, the failure modes that retired the earlier raster
 * mascots), the stethoscope used as the style reference for every other
 * object, then cropped to the object and encoded to WebP. They sit on any
 * card, in light and dark mode alike.
 *
 * Decorative only: empty alt + aria-hidden, never interactive. Already
 * sized for 3x screens, hence `unoptimized` (no image-optimizer round trip).
 * Lazy by default, so a copy inside a phone-hidden block is never fetched.
 */
export type GlassArtName =
  | "stethoscope"
  | "graduation"
  | "sources"
  | "notes"
  | "search"
  | "todo"
  | "fracture"
  | "dna"
  | "capsule"
  | "heart"
  | "neuron"
  | "molecule"
  | "microscope";

interface GlassArtProps {
  name: GlassArtName;
  /** Intrinsic square size in CSS px; responsive sizes go through `className`. */
  size: number;
  className?: string;
}

export function GlassArt({ name, size, className }: GlassArtProps) {
  return (
    <Image
      src={`/art/glass/${name}.webp`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      unoptimized
      draggable={false}
      className={cn("pointer-events-none select-none", className)}
    />
  );
}
