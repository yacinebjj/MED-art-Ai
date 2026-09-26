// Keeps public/pdf.worker.min.mjs in lockstep with the pdfjs-dist build that
// react-pdf actually bundles (its own nested node_modules/react-pdf/node_modules/pdfjs-dist,
// NOT the top-level pdfjs-dist dependency, whose version can drift from what react-pdf expects).
// A mismatched API/worker version fails PDF.js loading silently in the browser console
// ("The API version does not match the Worker version").
//
// Deriving the path via require.resolve("react-pdf/node_modules/pdfjs-dist/...") looks
// tempting but is WRONG: Node treats that whole string as a subpath import into the
// "react-pdf" package and checks it against react-pdf's own package.json "exports" map,
// which doesn't declare that subpath -> ERR_INVALID_MODULE_SPECIFIER (this broke the
// Vercel build). Resolving react-pdf's package.json first and joining the nested
// pdfjs-dist path ourselves is plain filesystem math, so it never goes through that
// exports-map enforcement.
const fs = require("fs");
const path = require("path");

const reactPdfDir = path.dirname(require.resolve("react-pdf/package.json"));
const src = path.join(reactPdfDir, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = path.join(__dirname, "..", "public", "pdf.worker.min.mjs");

fs.copyFileSync(src, dest);
console.log(`[copy-pdf-worker] synced ${path.relative(process.cwd(), dest)} from ${src}`);
