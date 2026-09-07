"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatImageProps {
  src: string;
}

/** Blur-up while loading, rounded corners, click to expand into a full-screen lightbox. */
export function ChatImage({ src }: ChatImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setExpanded(true)} className="block max-h-64 max-w-full overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Image envoyée"
          onLoad={() => setLoaded(true)}
          className={cn("max-h-64 max-w-full object-cover transition-all duration-500", loaded ? "scale-100 blur-0" : "scale-105 blur-md")}
        />
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setExpanded(false)}
                className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/90 p-6"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
                <motion.img
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  src={src}
                  alt="Image envoyée en grand"
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
                />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
