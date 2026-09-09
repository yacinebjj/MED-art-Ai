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
  // wss:// (not just https://) is required here — components/groups/ChatRoom.tsx
  // uses Supabase Realtime (postgres_changes/presence/broadcast channels over
  // a WebSocket) for live group chat; without it this CSP would silently
  // break that feature while leaving everything else looking fine.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com",
  // components/course/workspace/FileViewerModal.tsx's "Afficher le cours"
  // iframes either the raw uploaded file straight from Supabase Storage
  // (PDF) or Google Docs Viewer (docs.google.com/gview, for Office formats)
  // — both needed here, or that feature silently breaks for every file type.
  "frame-src https://accounts.google.com https://docs.google.com https://*.supabase.co",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["officeparser"],
    // lucide-react (per-icon files) and framer-motion were being pulled in
    // as their full barrel export on every import — this makes Next.js
    // rewrite each import to its actual submodule so unused icons/motion
    // internals never reach the client bundle at all, instead of relying on
    // webpack tree-shaking to catch it after the fact.
    optimizePackageImports: ["lucide-react", "framer-motion"],
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
          // Only disables features this app genuinely never uses — leaves
          // everything else (including the Screen Wake Lock API this app
          // does use, lib/studio-explication-client.ts) untouched.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
