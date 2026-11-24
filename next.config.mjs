import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// SECURITY: this app previously shipped with zero security headers at all —
// no CSP/frame-ancestors (real clickjacking exposure: the login/dashboard/
// exam pages could be iframed on an attacker's site), no nosniff, no
// Referrer-Policy. The CSP below is deliberately permissive rather than a
// strict nonce-based lockdown — this app cannot currently be exercised
// end-to-end in a live browser from this environment (auth-gated dashboard),
// so a strict CSP risks silently breaking Google's OAuth popup (Google
// Identity Services, lib/google-drive-picker.ts) or the Drive REST calls it
// makes directly from the browser (components/dashboard/DriveBrowser.tsx)
// with no easy way to catch it before students do. 'unsafe-inline'/
// 'unsafe-eval' on script-src specifically exist because Next.js's own
// App Router hydration/RSC payload relies on inline scripts without a nonce
// wired in — removing them requires a nonce-based CSP (a bigger, separate
// change), not a drop-in tightening.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // <audio>/<video> sources. WITHOUT this directive media fell back to
  // default-src 'self', so every file served from Supabase Storage — Studio
  // podcasts, lecture-note audio, group voice messages, media vault — was
  // blocked by the browser, and so were the blob: URLs the podcast player
  // falls back to: all three playback attempts failed and the student saw
  // "Lecture impossible : le fichier audio n'a pas pu être chargé".
  // blob:/data: also cover recorded voice notes and generated speech.
  "media-src 'self' blob: data: https://*.supabase.co",
  // wss:// (not just https://) is required here — components/groups/ChatRoom.tsx
  // uses Supabase Realtime (postgres_changes/presence/broadcast channels over
  // a WebSocket) for live group chat; without it this CSP would silently
  // break that feature while leaving everything else looking fine.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com",
  // components/course-viewer's "Afficher le cours"
  // iframes either the raw uploaded file straight from Supabase Storage
  // (PDF) or Google Docs Viewer (docs.google.com/gview, for Office formats)
  // — both needed here, or that feature silently breaks for every file type.
  // view.officeapps.live.com: CourseViewer previews DOCX/XLSX courses in
  // Microsoft Office Online embed viewer — without it that preview was blocked.
  "frame-src https://accounts.google.com https://docs.google.com https://view.officeapps.live.com https://*.supabase.co",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Loader that strips the one regex lookbehind old iPhones can't parse (see the file). */
const STRIP_LOOKBEHIND_LOADER = fileURLToPath(new URL("./scripts/webpack/strip-regex-lookbehind-loader.cjs", import.meta.url));
/** Loader that rewrites class static blocks, which old iPhones can't parse either (see the file). */
const STATIC_BLOCK_LOADER = fileURLToPath(new URL("./scripts/webpack/static-block-loader.cjs", import.meta.url));
/**
 * pdf.js's legacy build — the one react-pdf bundles (resolved from react-pdf
 * itself, so it stays in lockstep with public/pdf.worker.min.mjs, see
 * scripts/copy-pdf-worker.js). The default "modern" build needs Chrome 119 /
 * Safari 17.4 (Promise.withResolvers…): on older phones and on Windows 7/8
 * laptops (Chrome 109) every course PDF fell back to plain text.
 */
const PDFJS_LEGACY = createRequire(createRequire(import.meta.url).resolve("react-pdf/package.json")).resolve("pdfjs-dist/legacy/build/pdf.mjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security: the Image Optimization API (/_next/image) is switched off.
  // Next.js 14.x is affected by critical unauthenticated remote-code-execution
  // advisories in that endpoint's image decoding — GHSA-2464-fhr4-w9xw (SVG)
  // and GHSA-2xp9-vwfh-vxw4 (AVIF), Linux — and no 14.x release fixes them
  // (patched in 15.5.28 / 16.4.1). With `unoptimized`, <Image> renders the
  // plain static URL and Next.js answers 404 to every /_next/image request
  // before any image is decoded (next-server.js handleNextImageRequest), so
  // the vulnerable code never runs. MedArt only ever sent /logo.png through
  // it (Logo, SplashScreen, BrandLoader); GlassArt was already `unoptimized`.
  // Remove this only after upgrading to a patched Next.js release.
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ["officeparser"],
    // lucide-react (per-icon files) and framer-motion were being pulled in
    // as their full barrel export on every import — this makes Next.js
    // rewrite each import to its actual submodule so unused icons/motion
    // internals never reach the client bundle at all, instead of relying on
    // webpack tree-shaking to catch it after the fact.
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  webpack(config, { isServer }) {
    // remark-gfm's e-mail autolinks use a regex lookbehind that Safari < 16.4
    // (iOS 15/16 iPhones) refuses to parse, taking the course module page,
    // the workspace and the assistant down with it on those phones.
    config.module.rules.push({
      test: /[\\/]node_modules[\\/]mdast-util-gfm-autolink-literal[\\/]lib[\\/]index\.js$/,
      use: [{ loader: STRIP_LOOKBEHIND_LOADER }],
    });
    if (!isServer) {
      // The PDF viewer (react-pdf) on pdf.js's legacy build, minus its one static block.
      config.resolve.alias = { ...config.resolve.alias, "pdfjs-dist$": PDFJS_LEGACY };
      config.module.rules.push({
        test: /[\\/]pdfjs-dist[\\/]legacy[\\/]build[\\/]pdf\.mjs$/,
        use: [{ loader: STATIC_BLOCK_LOADER }],
      });
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          // Redundant with frame-ancestors above for modern browsers, kept
          // for older ones that only understand this header.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disables the features this app never uses. The microphone is
          // allowed for this origin only: voice dictation, voice mode and
          // group voice notes all call getUserMedia, and `microphone=()`
          // made Chrome/Edge/Firefox on desktop refuse it before any
          // permission prompt ("Micro inaccessible"). The Screen Wake Lock
          // API (lib/studio-explication-client.ts) stays untouched.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
