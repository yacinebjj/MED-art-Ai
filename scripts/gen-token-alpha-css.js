#!/usr/bin/env node
/**
 * Generates components/ui/token-alpha.css.
 *
 * Why: the theme colors in tailwind.config.ts are full CSS variables holding
 * oklch() values ("var(--popover)"), so Tailwind cannot apply an opacity
 * modifier to them — classes like `bg-popover/95`, `border-border/60` or
 * `bg-primary/10` are silently NOT generated. Menus and popovers using them
 * rendered with NO background at all (transparent dropdowns over the page).
 *
 * This script scans the sources for every such class (with its variants) and
 * writes real rules using color-mix(), so they behave exactly as intended.
 * Run it again after adding new token/opacity classes:
 *   node scripts/gen-token-alpha-css.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRS = ["app", "components", "lib", "providers", "hooks"];
const OUT = path.join(ROOT, "components/ui/token-alpha.css");

const TOKENS = {
  popover: "--popover",
  "popover-foreground": "--popover-foreground",
  card: "--card",
  "card-foreground": "--card-foreground",
  background: "--background",
  foreground: "--foreground",
  muted: "--muted",
  "muted-foreground": "--muted-foreground",
  accent: "--accent",
  "accent-foreground": "--accent-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  destructive: "--destructive",
  "destructive-foreground": "--destructive-foreground",
  primary: "--primary",
  "primary-foreground": "--primary-foreground",
  secondary: "--secondary",
  "secondary-foreground": "--secondary-foreground",
};

const UTILITY = /^(bg|text|border|ring|from|via|to|divide|outline|fill|stroke|placeholder)-([a-z-]+?)\/(\d+|\[[\d.]+\])$/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
  }
  return out;
}

function esc(cls) {
  return cls.replace(/([:/\[\].%=&>()#,!@'"])/g, "\\$1");
}

function percent(raw) {
  const m = raw.match(/^\[([\d.]+)\]$/);
  const value = m ? Number(m[1]) * 100 : Number(raw);
  return `${+value.toFixed(2)}%`;
}

function declaration(kind, cssVar, pct) {
  const color = `color-mix(in oklch, var(${cssVar}) ${pct}, transparent)`;
  switch (kind) {
    case "bg":
      return `background-color: ${color}`;
    case "text":
      return `color: ${color}`;
    case "border":
      return `border-color: ${color}`;
    case "divide":
      return null; // handled as a child selector
    case "ring":
      return `--tw-ring-color: ${color}`;
    case "outline":
      return `outline-color: ${color}`;
    case "fill":
      return `fill: ${color}`;
    case "stroke":
      return `stroke: ${color}`;
    case "from":
      return `--tw-gradient-from: ${color} var(--tw-gradient-from-position); --tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to)`;
    case "via":
      return `--tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), ${color} var(--tw-gradient-via-position), var(--tw-gradient-to)`;
    case "to":
      return `--tw-gradient-to: ${color} var(--tw-gradient-to-position)`;
    default:
      return null;
  }
}

const PSEUDO = {
  hover: ":hover",
  focus: ":focus",
  "focus-visible": ":focus-visible",
  "focus-within": ":focus-within",
  active: ":active",
  disabled: ":disabled",
  even: ":nth-child(even)",
  odd: ":nth-child(odd)",
  first: ":first-child",
  last: ":last-child",
};
const MEDIA = { sm: "640px", md: "768px", lg: "1024px", xl: "1280px", "2xl": "1536px" };

/** Returns { selector, media } or null for unsupported variants. */
function buildSelector(token, variants) {
  let selector = `.${esc(token)}`;
  let prefix = "";
  let media = null;
  for (const variant of variants) {
    if (PSEUDO[variant]) selector += PSEUDO[variant];
    else if (variant === "dark") prefix = ":is(.dark *)";
    else if (variant === "group-hover") prefix = `.group:hover `;
    else if (variant === "placeholder") selector += "::placeholder";
    else if (MEDIA[variant]) media = MEDIA[variant];
    else if (/^data-\[(.+)\]$/.test(variant)) {
      const attr = variant.match(/^data-\[(.+)\]$/)[1];
      const [name, value] = attr.split("=");
      selector += value !== undefined ? `[data-${name}="${value}"]` : `[data-${name}]`;
    } else return null;
  }
  if (prefix === ":is(.dark *)") selector = `${selector}:is(.dark *)`;
  else if (prefix) selector = `${prefix}${selector}`;
  return { selector, media };
}

const files = SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir), []));
const tokens = new Set();
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  for (const candidate of src.match(/[A-Za-z0-9:_\-\/\[\].=]+/g) ?? []) {
    const parts = candidate.split(":");
    const utility = parts[parts.length - 1];
    const m = utility.match(UTILITY);
    if (m && TOKENS[m[2]]) tokens.add(candidate);
  }
}

const rules = [];
const skipped = [];
for (const token of Array.from(tokens).sort()) {
  const parts = token.split(":");
  const utility = parts.pop();
  const [, kind, name, alpha] = utility.match(UTILITY);
  const built = buildSelector(token, parts);
  if (!built) {
    skipped.push(token);
    continue;
  }
  let { selector } = built;
  let decl = declaration(kind, TOKENS[name], percent(alpha));
  if (kind === "divide") {
    selector = `${selector} > :not([hidden]) ~ :not([hidden])`;
    decl = `border-color: color-mix(in oklch, var(${TOKENS[name]}) ${percent(alpha)}, transparent)`;
  }
  if (kind === "placeholder") {
    selector = `${selector}::placeholder`;
    decl = `color: color-mix(in oklch, var(${TOKENS[name]}) ${percent(alpha)}, transparent)`;
  }
  if (!decl) {
    skipped.push(token);
    continue;
  }
  const body = `${selector} {\n  ${decl.split("; ").join(";\n  ")};\n}`;
  rules.push(built.media ? `@media (min-width: ${built.media}) {\n${body.replace(/^/gm, "  ")}\n}` : body);
}

const header = `/*
 * GENERATED by scripts/gen-token-alpha-css.js — do not edit by hand.
 * Real color-mix() rules for theme-token colors used with an opacity
 * modifier (bg-popover/95, border-border/60, bg-primary/10, …), which
 * Tailwind cannot generate for "var(--token)" colors holding oklch() values.
 */
`;
fs.writeFileSync(OUT, `${header}\n${rules.join("\n\n")}\n`);
console.log(`${rules.length} rules written to ${path.relative(ROOT, OUT)}`);
if (skipped.length) console.log(`Unsupported variants skipped: ${skipped.join(", ")}`);
