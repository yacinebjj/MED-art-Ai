"use client";

import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { MAX_IMAGE_SRC_CHARS, type VerifiedMedicalImage } from "@/lib/medical-images";
import { markMedicalImagePainted, peekMedicalImage, resolveMedicalImageInBrowser, wasMedicalImagePainted } from "@/lib/medical-image-client";

/**
 * An image a Copilot reply embedded (Markdown ![description](link)) — shown
 * only as a VERIFIED Wikimedia Commons file (lib/medical-images.ts), never as
 * the link the model wrote: a quiet placeholder while the link is checked,
 * then the real picture on a white plate (diagrams are drawn for white paper —
 * their black labels must stay readable in dark mode), the reply's
 * description as its caption, and the source, license and author, linked to
 * the file's Commons page. When no real image fits, or it fails to load:
 * nothing at all, never a broken image.
 *
 * Built from <span>s on purpose: Markdown puts an image inside a paragraph,
 * where a <figure> or <div> would be invalid HTML.
 */
export const MedicalFigure = memo(function MedicalFigure({ src, alt }: { src?: string; alt?: string }) {
  const link = typeof src === "string" ? src.trim() : "";
  const caption = (alt ?? "").replace(/\s+/g, " ").trim();
  if (!/^https?:\/\//i.test(link) || link.length > MAX_IMAGE_SRC_CHARS) return null;
  // Keyed by the image itself: another link (the reply still streaming, a regenerated answer) starts over.
  return <ResolvedFigure key={`${link}\u0000${caption}`} link={link} caption={caption} />;
});

function ResolvedFigure({ link, caption }: { link: string; caption: string }) {
  const [image, setImage] = useState<VerifiedMedicalImage | null | undefined>(() => peekMedicalImage(link, caption));
  const [painted, setPainted] = useState(() => Boolean(image && wasMedicalImagePainted(image.src)));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image !== undefined) return;
    let cancelled = false;
    void resolveMedicalImageInBrowser(link, caption).then((result) => {
      if (!cancelled) setImage(result);
    });
    return () => {
      cancelled = true;
    };
  }, [image, link, caption]);

  if (image === null || failed) return null;

  if (image === undefined) {
    return (
      <span aria-hidden="true" className="not-prose my-[0.9em] block">
        <span className="block h-40 w-full animate-pulse rounded-2xl bg-black/[0.04] dark:bg-white/[0.06]" />
      </span>
    );
  }

  const credit = ["Wikimedia Commons", image.license, image.artist].filter(Boolean).join(" · ");
  return (
    <span role="figure" aria-label={caption || image.title.replace(/^File:/i, "")} className="not-prose my-[0.9em] block">
      <a
        href={image.pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Voir sur Wikimedia Commons"
        className="block overflow-hidden rounded-2xl border border-black/[0.07] bg-white p-2 dark:border-white/[0.1]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a verified Wikimedia file, served by Wikimedia itself (next/image would re-host it). */}
        <img
          src={image.src}
          width={image.width}
          height={image.height}
          alt={caption || image.title.replace(/^File:/i, "")}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            markMedicalImagePainted(image.src);
            setPainted(true);
          }}
          onError={() => setFailed(true)}
          className={cn(
            "mx-auto block h-auto max-h-[min(26rem,60vh)] w-auto max-w-full transition-opacity duration-300",
            painted ? "opacity-100" : "opacity-0"
          )}
        />
      </a>
      <span dir="auto" className="mt-1.5 block px-1 text-[0.78em] leading-snug text-slate-500 dark:text-zinc-400">
        {caption && <span className="font-medium text-slate-600 dark:text-zinc-300">{caption} · </span>}
        {credit}
      </span>
    </span>
  );
}
