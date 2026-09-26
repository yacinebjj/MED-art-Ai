// Keeps public/pdf.worker.min.mjs in lockstep with the pdfjs-dist build that
// react-pdf actually bundles (its own nested node_modules/react-pdf/node_modules/pdfjs-dist,
// NOT the top-level pdfjs-dist dependency, whose version can drift from what react-pdf expects).
// A mismatched API/worker version fails PDF.js loading silently in the browser console
// ("The API version does not match the Worker version").
const fs = require("fs");
const path = require("path");

const src = require.resolve("react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dest = path.join(__dirname, "..", "public", "pdf.worker.min.mjs");

fs.copyFileSync(src, dest);
console.log(`[copy-pdf-worker] synced ${path.relative(process.cwd(), dest)} from ${src}`);
