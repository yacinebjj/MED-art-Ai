#!/usr/bin/env node
/**
 * Post-build guard (npm "postbuild", so it runs on every Vercel build too).
 *
 * Fails the build if the browser bundles contain JavaScript that old — but
 * still very common — browsers cannot even PARSE. A parse error is not one
 * broken feature: the whole file is rejected, and with it every page that
 * loads it. This is exactly how the course module page, the workspace and the
 * assistant silently stopped loading on iPhones left on iOS 15/16.
 *
 *   - regex lookbehind `(?<=…)` / `(?<!…)` in a regex literal, anywhere:
 *     Safari < 16.4 rejects the file (iPhone 6s/7/8/X, still everywhere);
 *     or in a `RegExp("…")` call outside a try block (what our own literals
 *     are compiled to): it throws as soon as that code runs;
 *   - class static blocks `static { … }` in a file a page loads up front:
 *     Safari < 16.4 and Chrome < 94 reject it. (Lazily loaded extras — the
 *     Mermaid diagram engine — may keep theirs: they fail on their own and
 *     the page shows the lesson without the diagram.)
 *
 * When it fires: find the package that brought the syntax in (the file and
 * snippet are printed), and strip it in the build like
 * scripts/webpack/strip-regex-lookbehind-loader.cjs and static-block-loader.cjs
 * do, or load that code lazily with a fallback. SKIP_COMPAT_CHECK=1 bypasses
 * the check for an emergency deploy.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const CHUNKS = path.join(ROOT, ".next", "static", "chunks");

if (process.env.SKIP_COMPAT_CHECK === "1") {
  console.warn("[compat] SKIP_COMPAT_CHECK=1 — browser compatibility check skipped.");
  process.exit(0);
}
if (!fs.existsSync(CHUNKS)) {
  console.log("[compat] no client build found, nothing to check.");
  process.exit(0);
}

/** Files every page loads up front (not the lazily imported ones). */
const initial = new Set();
for (const manifest of ["app-build-manifest.json", "build-manifest.json"]) {
  try {
    const { pages = {} } = JSON.parse(fs.readFileSync(path.join(ROOT, ".next", manifest), "utf8"));
    for (const files of Object.values(pages)) for (const file of files) initial.add(path.basename(file));
  } catch {
    // Manifest missing: every file is then checked as lazily loaded.
  }
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

const problems = [];
let checked = 0;
for (const file of walk(CHUNKS)) {
  const text = fs.readFileSync(file, "utf8");
  const isInitial = initial.has(path.basename(file));
  // Cheap pre-filter: only files that could hold either construct are parsed.
  if (!text.includes("(?<") && !(isInitial && /static\s*\{/.test(text))) continue;
  checked += 1;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const snippet = (node) => text.slice(Math.max(0, node.pos - 40), Math.min(text.length, node.end + 40)).replace(/\s+/g, " ").trim();
  const visit = (node, inTry) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral && /\(\?<[=!]/.test(node.text)) {
      problems.push({ file, what: "regex lookbehind (Safari < 16.4 cannot parse this file)", snippet: snippet(node) });
    } else if (isInitial && node.kind === ts.SyntaxKind.ClassStaticBlockDeclaration) {
      problems.push({ file, what: "class static block in a file pages load up front (Safari < 16.4, Chrome < 94)", snippet: snippet(node) });
    } else if (
      !inTry &&
      (node.kind === ts.SyntaxKind.CallExpression || node.kind === ts.SyntaxKind.NewExpression) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp" &&
      node.arguments?.[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      /\(\?<[=!]/.test(node.arguments[0].text)
    ) {
      // Our own regex literals are compiled to RegExp("…") calls: they throw when the module runs.
      // Inside a try block it is a feature test (e.g. marked checks lookbehind support) — fine.
      problems.push({ file, what: "RegExp with lookbehind, outside any try (throws on Safari < 16.4 when this code runs)", snippet: snippet(node) });
    }
    if (node.kind === ts.SyntaxKind.TryStatement) {
      visit(node.tryBlock, true);
      if (node.catchClause) visit(node.catchClause, inTry);
      if (node.finallyBlock) visit(node.finallyBlock, inTry);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, inTry));
  };
  visit(source, false);
}

if (problems.length) {
  console.error(`\n[compat] ${problems.length} construct(s) that old browsers cannot parse:\n`);
  for (const p of problems.slice(0, 20)) console.error(`  ✗ ${path.relative(ROOT, p.file)}\n    ${p.what}\n    …${p.snippet.slice(0, 220)}…\n`);
  console.error("[compat] Students on older iPhones / Windows 7-8 laptops would get pages that never load. See scripts/check-browser-compat.mjs.");
  process.exit(1);
}
console.log(`[compat] OK — no lookbehind regex, no up-front static blocks (${checked} candidate file(s) parsed).`);
