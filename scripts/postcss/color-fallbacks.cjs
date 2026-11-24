/**
 * PostCSS plugin: sRGB fallbacks for oklch() and color-mix(), for browsers
 * that support neither — computed at build time, applied only where needed.
 *
 * Why: every theme color is an oklch() token (app/globals.css) and every
 * "token with opacity" class (bg-background/80, border-border/60, the
 * generated components/ui/token-alpha.css, Tailwind arbitrary values,
 * the Atlas module…) is a color-mix(). Browsers without them treat those
 * colors as invalid — the property falls back to transparent/black:
 *   - Chrome/Edge < 111 → Windows 7/8.1 laptops are frozen on Chrome 109,
 *     plus old Android WebViews and Huawei/Samsung browsers: no oklch(), no
 *     color-mix(): white cards, invisible buttons, see-through menus/modals.
 *   - Safari < 16.2 → iPhones left on iOS 15/16.0–16.1 (6s, 7, SE): oklch()
 *     works but color-mix() doesn't: see-through overlays, sheets, headers.
 *
 * What it adds (modern browsers ignore all of it — their CSS is unchanged):
 *   1. After each rule defining a custom property in oklch() — the theme
 *      tokens — the same rule with the exact sRGB value, inside
 *      `@supports not (color: oklch(0 0 0))`.
 *   2. For every `color-mix(in <space>, var(--token) N%, <color>)`: the result
 *      is precomputed for each place that defines --token (light :root,
 *      .dark, Atlas themes…) as a `--mixfb-…` variable, and the rule using it
 *      gets a twin reading that variable, inside
 *      `@supports not (color: color-mix(in srgb, red 50%, blue))`.
 *      Same selector, right after the original: same cascade, same variants.
 *   3. Plain declarations with a static oklch()/color-mix() (no var()) get a
 *      static fallback declaration just before them.
 *   4. dvh/svh/lvh lengths get a vh fallback (browsers without dynamic
 *      viewport units dropped them: modals lost their max-height).
 * Values are clipped to sRGB, as Chrome renders them on an sRGB screen.
 */

const fs = require("fs");
const path = require("path");

const OKLCH_SUPPORTS = "not (color: oklch(0 0 0))";
const MIX_SUPPORTS = "not (color: color-mix(in srgb, red 50%, blue))";
const DVH_SUPPORTS = "not (height: 1dvh)";
const DYNAMIC_VIEWPORT = /(\d)(dvh|svh|lvh)\b/g;

// ── Color math (CSS Color 4/5) ───────────────────────────────────────────────

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const fromLinear = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

function oklabToSrgb([L, a, b]) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function srgbToOklab([r, g, b]) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const oklabToOklch = ([L, a, b]) => {
  const C = Math.hypot(a, b);
  return [L, C, C < 1e-4 ? NaN : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
};
const oklchToOklab = ([L, C, H]) => (Number.isNaN(H) ? [L, 0, 0] : [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]);

/** A parsed color: sRGB channels in 0–1 (unclipped) + alpha. */
function num(token, percentScale = 1) {
  const t = String(token).trim();
  if (t === "none") return 0;
  if (t.endsWith("%")) return (parseFloat(t) / 100) * percentScale;
  if (t.endsWith("deg")) return parseFloat(t);
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

function parseColor(input) {
  const v = input.trim().toLowerCase();
  if (v === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
  if (v === "white") return { rgb: [1, 1, 1], alpha: 1 };
  if (v === "black") return { rgb: [0, 0, 0], alpha: 1 };
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const ch = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { rgb: [ch(0), ch(2), ch(4)], alpha: h.length === 8 ? ch(6) : 1 };
  }
  m = v.match(/^(oklch|oklab|rgba?)\(([^()]*)\)$/);
  if (!m) return null;
  const [main, alphaPart] = m[2].split("/");
  const parts = main.split(/[\s,]+/).filter(Boolean);
  let alpha = alphaPart === undefined ? 1 : num(alphaPart);
  if (m[1].startsWith("rgb")) {
    if (parts.length === 4 && alphaPart === undefined) alpha = num(parts.pop());
    if (parts.length !== 3) return null;
    const rgb = parts.map((p) => (p.endsWith("%") ? num(p) : num(p) / 255));
    return rgb.some(Number.isNaN) || Number.isNaN(alpha) ? null : { rgb, alpha };
  }
  if (parts.length !== 3) return null;
  if (m[1] === "oklch") {
    const L = num(parts[0]), C = num(parts[1], 0.4), H = parts[2] === "none" ? NaN : num(parts[2]);
    if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(alpha)) return null;
    return { rgb: oklabToSrgb(oklchToOklab([L, C, H])), alpha };
  }
  const lab = [num(parts[0]), num(parts[1], 0.4), num(parts[2], 0.4)];
  return lab.some(Number.isNaN) || Number.isNaN(alpha) ? null : { rgb: oklabToSrgb(lab), alpha };
}

/** color-mix(in space, c1 p, c2) with premultiplied alpha and shorter hue (CSS Color 5). */
function mix(space, c1, p1, c2) {
  const p2 = 1 - p1;
  const alpha = c1.alpha * p1 + c2.alpha * p2;
  if (alpha <= 0) return { rgb: [0, 0, 0], alpha: 0 };
  const into = (c) => (space === "srgb" ? c.rgb : space === "oklab" ? srgbToOklab(c.rgb) : oklabToOklch(srgbToOklab(c.rgb)));
  const a = into(c1), b = into(c2);
  // A fully transparent side (or an achromatic hue) carries no hue: take the other's.
  if (space === "oklch") {
    if (c2.alpha === 0 || Number.isNaN(b[2])) b[2] = a[2];
    if (c1.alpha === 0 || Number.isNaN(a[2])) a[2] = b[2];
  }
  const out = [0, 1, 2].map((i) => {
    if (space === "oklch" && i === 2) {
      if (Number.isNaN(a[2]) && Number.isNaN(b[2])) return NaN;
      let d = b[2] - a[2];
      if (d > 180) d -= 360;
      else if (d < -180) d += 360;
      const w = (c2.alpha * p2) / alpha;
      return (a[2] + d * w + 360) % 360;
    }
    return (a[i] * c1.alpha * p1 + b[i] * c2.alpha * p2) / alpha;
  });
  const rgb = space === "srgb" ? out : space === "oklab" ? oklabToSrgb(out) : oklabToSrgb(oklchToOklab(out));
  return { rgb, alpha };
}

function format({ rgb, alpha }) {
  const [r, g, b] = rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  if (a >= 1) return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ── Value scanning ───────────────────────────────────────────────────────────

/** Every `name(…)` call in a value, with balanced parentheses. */
function findCalls(value, name) {
  const out = [];
  const re = new RegExp(`(^|[^\\w-])${name}\\(`, "gi");
  let m;
  while ((m = re.exec(value))) {
    const start = m.index + m[1].length;
    let depth = 0;
    for (let i = start + name.length; i < value.length; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")" && --depth === 0) {
        out.push({ start, end: i + 1, text: value.slice(start, i + 1) });
        re.lastIndex = i + 1;
        break;
      }
    }
  }
  return out;
}

/** Splits on top-level commas. */
function splitArgs(inner) {
  const out = [];
  let depth = 0, last = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "(") depth++;
    else if (inner[i] === ")") depth--;
    else if (inner[i] === "," && depth === 0) {
      out.push(inner.slice(last, i).trim());
      last = i + 1;
    }
  }
  out.push(inner.slice(last).trim());
  return out;
}

/** Parses color-mix(in space, A [p], B [q]) → { space, a, pa, b } (strings + p for A). */
function parseMix(call) {
  const args = splitArgs(call.text.slice(call.text.indexOf("(") + 1, -1));
  if (args.length !== 3) return null;
  const sm = args[0].match(/^in\s+(srgb|oklab|oklch)(?:\s+shorter\s+hue)?$/i);
  if (!sm) return null;
  const side = (s) => {
    const pm = s.match(/^(.*?)\s+([\d.]+)%$/) || s.match(/^([\d.]+)%\s+(.*)$/);
    if (!pm) return { color: s, p: null };
    return /%$/.test(s) ? { color: pm[1].trim(), p: parseFloat(pm[2]) / 100 } : { color: pm[2].trim(), p: parseFloat(pm[1]) / 100 };
  };
  const A = side(args[1]), B = side(args[2]);
  let pa = A.p, pb = B.p;
  if (pa === null && pb === null) pa = 0.5;
  else if (pa === null) pa = 1 - pb;
  else if (pb !== null && Math.abs(pa + pb - 1) > 1e-6) return null; // alpha-multiplier forms: not used here
  return { space: sm[1].toLowerCase(), a: A.color, pa, b: B.color };
}

/** Static value: replace every oklch()/color-mix() by its sRGB result, or null if any can't be computed. */
function staticFallback(value) {
  let failed = false;
  const replaceCalls = (val, name, fn) => {
    const calls = findCalls(val, name);
    let out = "", last = 0;
    for (const c of calls) {
      const rep = fn(c);
      if (rep === null) failed = true;
      out += val.slice(last, c.start) + (rep ?? c.text);
      last = c.end;
    }
    return out + val.slice(last);
  };
  let out = replaceCalls(value, "color-mix", (c) => {
    const p = parseMix(c);
    const A = p && parseColor(staticFallback(p.a) ?? p.a), B = p && parseColor(staticFallback(p.b) ?? p.b);
    return A && B ? format(mix(p.space, A, p.pa, B)) : null;
  });
  out = replaceCalls(out, "oklch", (c) => {
    const col = parseColor(c.text);
    return col ? format(col) : null;
  });
  out = replaceCalls(out, "oklab", (c) => {
    const col = parseColor(c.text);
    return col ? format(col) : null;
  });
  return failed ? null : out;
}

const VAR_ONLY = /^var\(\s*(--[\w-]+)\s*\)$/;
const mixVarName = (token, p, space, other) => {
  const pct = String(Math.round(p * 10000) / 100).replace(".", "_");
  if (other.trim().toLowerCase() === "transparent") return `--mixfb-${token.slice(2)}-${pct}`;
  const tag = other.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `--mixfb-${token.slice(2)}-${pct}-${space}-${tag}`;
};

function insideSupports(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && /supports/i.test(p.name)) return true;
  return false;
}
function insideKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true;
  return false;
}

/**
 * The theme tokens (app/globals.css, `:root` = light and `.dark`), read from
 * the file itself: they are used in other stylesheets (token-alpha.css,
 * Tailwind's arbitrary values…), which PostCSS processes separately.
 */
const GLOBALS = path.join(__dirname, "../../app/globals.css");
let themeCache = { mtime: -1, tokens: new Map() };
function themeTokens(postcss) {
  let mtime = 0;
  try {
    mtime = fs.statSync(GLOBALS).mtimeMs;
  } catch {
    return themeCache.tokens;
  }
  if (mtime === themeCache.mtime) return themeCache.tokens;
  const tokens = new Map();
  try {
    postcss.parse(fs.readFileSync(GLOBALS, "utf8")).walkRules((rule) => {
      const theme = rule.selector.trim() === ":root" ? "light" : rule.selector.trim() === ".dark" ? "dark" : null;
      if (!theme || insideSupports(rule)) return;
      rule.each((d) => {
        if (d.type !== "decl" || !d.prop.startsWith("--")) return;
        const color = parseColor(d.value);
        if (color) tokens.set(d.prop, { ...tokens.get(d.prop), [theme]: color });
      });
    });
  } catch {
    // Unreadable: no cross-file theme fallbacks, everything else still works.
  }
  themeCache = { mtime, tokens };
  return tokens;
}

/** A selector already scoped to the dark theme (`.dark .x`, Tailwind's `x:is(.dark *)`). */
const DARK_SCOPED = /(^|[\s>+~(,])\.dark(?![\w-])/;
function darkVersion(selector) {
  if (/^:root/.test(selector)) return selector.replace(/^:root/, ":root:where(.dark)");
  if (/^html(?![\w-])/.test(selector)) return selector.replace(/^html/, "html:where(.dark)");
  return `:where(.dark) ${selector}`;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const plugin = () => ({
  postcssPlugin: "medart-color-fallbacks",
  OnceExit(root, helpers) {
    const { AtRule, Rule, Declaration: Decl, list } = helpers;
    const theme = themeTokens(helpers.postcss);

    /** --token → [{ rule, color, oklch }]: rules of THIS stylesheet defining a token with a static color. */
    const defs = new Map();
    root.walkDecls((decl) => {
      if (!decl.prop.startsWith("--") || insideSupports(decl) || insideKeyframes(decl) || decl.parent.type !== "rule") return;
      if (decl.value.toLowerCase().includes("color-mix(")) return;
      const color = parseColor(decl.value);
      if (color) (defs.get(decl.prop) || defs.set(decl.prop, []).get(decl.prop)).push({ rule: decl.parent, color, oklch: /okl(ch|ab)\(/i.test(decl.value) });
    });

    /** --mixfb var → { token, space, p, other }: precomputed in the rules defining the token. */
    const mixVars = new Map();
    /** rule → [{ condition, selector, decls }]: fallback twins to emit right after the rule. */
    const twins = new Map();
    const addTwin = (rule, condition, selector, decl) => {
      const listForRule = twins.get(rule) || twins.set(rule, []).get(rule);
      let twin = listForRule.find((t) => t.condition === condition && t.selector === selector);
      if (!twin) listForRule.push((twin = { condition, selector, decls: [] }));
      twin.decls.push(decl);
    };

    root.walkDecls((decl) => {
      if (insideSupports(decl)) return;
      const value = decl.value;
      const lower = value.toLowerCase();
      const hasMix = lower.includes("color-mix(");
      const hasOk = /okl(ch|ab)\(/.test(lower);
      if (!hasMix && !hasOk) return;
      const isCustom = decl.prop.startsWith("--");
      const inRule = decl.parent.type === "rule" && !insideKeyframes(decl);
      if (isCustom && !hasMix && inRule && parseColor(value)) return; // an oklch() token: handled per rule below

      // The fallback value, per theme when a theme token is mixed: static color-mix()/oklch() → sRGB;
      // color-mix(var(--token) p%, c) → the token's own --mixfb-… variable, or the theme's computed color.
      const variants = { light: "", dark: "" };
      let ok = true, themed = false, last = 0;
      for (const c of findCalls(value, "color-mix")) {
        let rep = null;
        const p = parseMix(c);
        if (p) {
          const staticMix = !/var\(/i.test(c.text) && staticFallback(c.text);
          if (staticMix) rep = { light: staticMix, dark: staticMix };
          else if (inRule) {
            const va = p.a.match(VAR_ONLY), vb = p.b.match(VAR_ONLY);
            const [token, pt, other] = va && !vb ? [va[1], p.pa, p.b] : vb && !va ? [vb[1], 1 - p.pa, p.a] : [];
            const otherStatic = other === undefined ? null : staticFallback(other) ?? other;
            const otherColor = otherStatic === null ? null : parseColor(otherStatic);
            if (token && otherColor) {
              if (defs.has(token)) {
                const name = mixVarName(token, pt, p.space, otherStatic);
                mixVars.set(name, { token, space: p.space, p: pt, other: otherColor });
                rep = { light: `var(${name})`, dark: `var(${name})` };
              } else if (theme.has(token)) {
                const t = theme.get(token);
                const light = t.light || t.dark, dark = t.dark || t.light;
                rep = { light: format(mix(p.space, light, pt, otherColor)), dark: format(mix(p.space, dark, pt, otherColor)) };
                themed = true;
              }
            }
          }
        }
        if (rep === null) {
          ok = false;
          break;
        }
        variants.light += value.slice(last, c.start) + rep.light;
        variants.dark += value.slice(last, c.start) + rep.dark;
        last = c.end;
      }
      if (!ok) return;
      variants.light += value.slice(last);
      variants.dark += value.slice(last);
      for (const k of ["light", "dark"]) {
        if (/okl(ch|ab)\(/i.test(variants[k])) {
          const fb = staticFallback(variants[k]);
          if (!fb) return;
          variants[k] = fb;
        }
      }
      if (variants.light === value) return;
      if (!isCustom && !lower.includes("var(")) {
        // Fully static: a plain declaration before it is enough (old browsers drop the invalid one at parse time).
        decl.cloneBefore({ value: variants.light });
        return;
      }
      if (!inRule) return;
      // var()-based or a custom property: only an @supports twin can stand in for it.
      const condition = hasMix ? MIX_SUPPORTS : OKLCH_SUPPORTS;
      const entry = (v) => ({ prop: decl.prop, value: v, important: decl.important });
      if (!themed || variants.light === variants.dark) {
        addTwin(decl.parent, condition, decl.parent.selector, entry(variants.light));
        return;
      }
      const selectors = list.comma(decl.parent.selector);
      const lightSel = selectors.filter((s) => !DARK_SCOPED.test(s));
      const darkSel = selectors.map((s) => (DARK_SCOPED.test(s) ? s : darkVersion(s)));
      if (lightSel.length) addTwin(decl.parent, condition, lightSel.join(","), entry(variants.light));
      addTwin(decl.parent, condition, darkSel.join(","), entry(variants.dark));
    });

    // 4. dvh/svh/lvh → vh, for browsers without dynamic viewport units (Chrome < 108, Samsung Internet < 21,
    //    older Huawei browsers, iOS < 15.4): a modal's max-h-[85dvh] used to be dropped there, so a long
    //    sheet grew past the screen with its buttons out of reach.
    root.walkDecls((decl) => {
      if (insideSupports(decl) || insideKeyframes(decl) || !/\d(?:dvh|svh|lvh)\b/.test(decl.value)) return;
      const vh = decl.value.replace(DYNAMIC_VIEWPORT, "$1vh");
      if (!decl.prop.startsWith("--") && !/var\(|env\(/i.test(decl.value)) {
        decl.cloneBefore({ value: vh }); // static: old browsers drop the dvh line at parse time and keep this one
        return;
      }
      if (decl.parent.type === "rule") addTwin(decl.parent, DVH_SUPPORTS, decl.parent.selector, { prop: decl.prop, value: vh, important: decl.important });
    });

    const emitAfter = (rule, condition, blocks) => {
      const at = new AtRule({ name: "supports", params: condition });
      for (const { selector, decls } of blocks) {
        const clone = new Rule({ selector });
        for (const d of decls) clone.append(new Decl(d));
        at.append(clone);
      }
      rule.after(at);
    };

    // Inserted after each rule in reverse order of priority, so they end up: oklch tokens, mix variables, twins.
    // 3. Twins of the rules using color-mix()/oklch() with var(): light first, then dark (same specificity, later wins).
    for (const [rule, list_] of twins) {
      for (const condition of [OKLCH_SUPPORTS, MIX_SUPPORTS, DVH_SUPPORTS].reverse()) {
        const blocks = list_.filter((t) => t.condition === condition);
        if (blocks.length) emitAfter(rule, condition, blocks);
      }
    }
    // 2. --mixfb-… variables, precomputed in every rule that defines the token.
    const varRules = new Map();
    for (const [name, mv] of mixVars) {
      for (const d of defs.get(mv.token) || []) {
        (varRules.get(d.rule) || varRules.set(d.rule, []).get(d.rule)).push({ prop: name, value: format(mix(mv.space, d.color, mv.p, mv.other)) });
      }
    }
    for (const [rule, decls] of varRules) emitAfter(rule, MIX_SUPPORTS, [{ selector: rule.selector, decls }]);
    // 1. oklch() tokens → sRGB, per defining rule.
    const tokenRules = new Map();
    for (const [prop, defList] of defs) for (const d of defList) if (d.oklch) (tokenRules.get(d.rule) || tokenRules.set(d.rule, []).get(d.rule)).push({ prop, value: format(d.color) });
    for (const [rule, decls] of tokenRules) emitAfter(rule, OKLCH_SUPPORTS, [{ selector: rule.selector, decls }]);
  },
});
plugin.postcss = true;

module.exports = plugin;
module.exports._internals = { parseColor, mix, format, staticFallback };
