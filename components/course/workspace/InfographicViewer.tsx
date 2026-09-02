"use client";

import { Download } from "lucide-react";

/**
 * Studio's "Infographie" tab content — a single generated mindmap image
 * (google/gemini-3.1-flash-image-preview via OpenRouter, cross-student
 * cached — see app/api/studio/infographic/route.ts). No custom zoom/lightbox
 * here: StudioPanel already gives every opened section a generic fullscreen
 * "Maximize2" toggle (its own header button), which this image inherits for
 * free by simply being rendered as StudioPanel's `children`.
 */
export function InfographicViewer({ imageUrl, courseTitle }: { imageUrl: string; courseTitle: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <img
        src={imageUrl}
        alt={`Infographie mindmap — ${courseTitle}`}
        className="w-full max-w-4xl rounded-2xl border border-border shadow-soft"
      />
      {/* `download` only forces a save (vs. just opening the image) on a
          same-origin URL in most browsers — Supabase Storage's public URL is
          cross-origin, so this is a best-effort nicety, not a guarantee;
          worst case the student sees the image and saves it manually. */}
      <a
        href={imageUrl}
        download={`infographie-${courseTitle.replace(/[^a-zA-Z0-9-_]/g, "_")}.png`}
        className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-glow dark:bg-primary-500 dark:hover:bg-primary-400"
      >
        <Download className="h-4 w-4" />
        Télécharger l&apos;infographie
      </a>
    </div>
  );
}
