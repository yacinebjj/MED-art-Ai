import localFont from "next/font/local";

/** Kalam 700 — the hand-lettered face of the atlas plates, self-hosted (no request to Google). */
export const atlasHand = localFont({
  src: "./kalam-700.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  fallback: ["Segoe Print", "Bradley Hand", "cursive"],
});
