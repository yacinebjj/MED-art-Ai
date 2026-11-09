/**
 * Copilot replies as a student should read them.
 *
 * The models behind the Copilot sometimes answer with LaTeX — \( \text{Na}^+ \),
 * $\Delta G$, $$pH = pK_a + \log\frac{[A^-]}{[HA]}$$, a bare \rightarrow — or
 * with HTML line breaks. The chat's Markdown renderer draws none of that, so
 * the raw syntax used to sit in the middle of a medical explanation. This
 * turns it into plain Unicode (Na⁺, ΔG, →, pH = pKₐ + log([A⁻]/[HA])): no math
 * engine, cheap enough to run on every streamed chunk, and code is never
 * touched (fenced blocks and `inline code` pass through as written).
 *
 * Display formulas become a ```medart-formula block, which
 * components/assistant/StreamedMarkdown.tsx draws as a centred formula card;
 * copy and read-aloud ask for them as plain lines instead (formulaBlocks: false).
 * Images the model wrote imperfectly are repaired first
 * (lib/image-markdown-repair.ts).
 */

import { repairImageMarkdown } from "@/lib/image-markdown-repair";

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};

const SUBSCRIPTS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

/** Kept as they are inside a script (T₁/₂, not a fallback). */
const SCRIPT_PASSTHROUGH = new Set(["/", ".", ","]);

const SYMBOLS: Record<string, string> = {
  // Greek
  alpha: "α", beta: "β", gamma: "γ", Gamma: "Γ", delta: "δ", Delta: "Δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", Theta: "Θ", iota: "ι", kappa: "κ", lambda: "λ", Lambda: "Λ", mu: "μ", nu: "ν", xi: "ξ", Xi: "Ξ",
  pi: "π", Pi: "Π", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", Sigma: "Σ", tau: "τ", upsilon: "υ", Upsilon: "Υ",
  phi: "φ", varphi: "φ", Phi: "Φ", chi: "χ", psi: "ψ", Psi: "Ψ", omega: "ω", Omega: "Ω",
  // Arrows
  rightarrow: "→", to: "→", longrightarrow: "⟶", leftarrow: "←", gets: "←", longleftarrow: "⟵", leftrightarrow: "↔",
  Rightarrow: "⇒", Longrightarrow: "⟹", implies: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", iff: "⇔",
  uparrow: "↑", downarrow: "↓", Uparrow: "⇑", Downarrow: "⇓", updownarrow: "↕", nearrow: "↗", searrow: "↘",
  rightleftharpoons: "⇌", leftrightharpoons: "⇋", rightleftarrows: "⇄", mapsto: "↦",
  // Relations and operators
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", bullet: "•", circ: "∘",
  leq: "≤", le: "≤", leqslant: "≤", geq: "≥", ge: "≥", geqslant: "≥", neq: "≠", ne: "≠", approx: "≈", sim: "∼", simeq: "≃",
  cong: "≅", equiv: "≡", propto: "∝", ll: "≪", gg: "≫", lesssim: "≲", gtrsim: "≳",
  infty: "∞", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", oint: "∮",
  in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃", cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅",
  forall: "∀", exists: "∃", neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨", oplus: "⊕", otimes: "⊗",
  perp: "⊥", parallel: "∥", angle: "∠", therefore: "∴", because: "∵",
  ldots: "…", dots: "…", cdots: "⋯", vdots: "⋮", prime: "′", degree: "°", hbar: "ℏ", ell: "ℓ",
  langle: "⟨", rangle: "⟩", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋", checkmark: "✓",
  lbrace: "{", rbrace: "}", vert: "|", Vert: "‖", backslash: "\\",
  // Spacing
  quad: " ", qquad: "  ", enspace: " ", thinspace: " ", medspace: " ", thickspace: " ",
  negthinspace: "", negmedspace: "", negthickspace: "",
};

/** Letter-like symbols: LaTeX drops the space that ends their name ("\Delta G" is ΔG), unlike around × or →. */
const TIGHT = new Set([
  "alpha", "beta", "gamma", "Gamma", "delta", "Delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "Theta",
  "iota", "kappa", "lambda", "Lambda", "mu", "nu", "xi", "Xi", "pi", "Pi", "rho", "varrho", "sigma", "varsigma", "Sigma",
  "tau", "upsilon", "Upsilon", "phi", "varphi", "Phi", "chi", "psi", "Psi", "omega", "Omega", "ell", "hbar", "partial", "nabla", "prime",
]);

const FUNCTIONS = new Set([
  "log", "ln", "lg", "exp", "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "lim", "max", "min", "sup", "inf", "det", "arg", "deg", "dim", "gcd", "ker", "Pr", "mod",
]);

/** Commands whose argument is shown as it is (the styling has no plain-text equivalent). */
const PASS_THROUGH = new Set([
  "text", "textrm", "textnormal", "textup", "textmd", "textsf", "texttt", "textsc", "mathrm", "mathbf", "mathit", "mathsf",
  "mathtt", "mathcal", "mathbb", "mathscr", "mathfrak", "mathnormal", "boldsymbol", "bm", "textbf", "textit", "emph",
  "operatorname", "mbox", "hbox", "underline", "overbrace", "underbrace", "boxed", "fbox", "cancel", "bcancel", "xcancel",
  "displaystyle", "textstyle", "scriptstyle", "small", "large", "Large", "footnotesize",
]);

/** Commands that only size or tag things: dropped, argument and all when they take one. */
const DROP_WITH_ARGUMENT = new Set(["label", "tag", "color", "hspace", "vspace", "phantom", "hphantom", "vphantom", "ref", "eqref"]);
const DROP_ALONE = new Set(["limits", "nolimits", "nonumber", "notag", "hline", "displaylimits", "centering", "noindent", "newline", "par"]);

const ACCENTS: Record<string, string> = {
  bar: "̄", overline: "̅", hat: "̂", widehat: "̂", tilde: "̃", widetilde: "̃",
  vec: "⃗", dot: "̇", ddot: "̈", acute: "́", grave: "̀", check: "̌", breve: "̆",
};

const DELIMITER_SIZERS = new Set(["left", "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr"]);

const ESCAPED: Record<string, string> = {
  ",": " ", ":": " ", ";": " ", ">": " ", "!": "", " ": " ",
  "%": "%", "&": "&", "#": "#", "_": "_", "$": "$", "{": "{", "}": "}", "|": "‖", "\\": "\n",
};

/** Own keys only: a stray \constructor must not find Object.prototype. */
function lookup(table: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** "x", "12", "[A⁻]" or "(a+b)" stay as they are next to "/" or "√"; anything longer gets parentheses. */
function isAtomic(value: string): boolean {
  // \p{N} covers the super/subscript digits (¹²³ sit outside ⁰–⁹'s code-point run).
  if (/^[\p{L}\p{N}.,′'°⁺⁻₊₋%]+$/u.test(value)) return true;
  return /^\(.*\)$|^\[.*\]$/.test(value) && !/^\(.*\)\s*\(.*\)$/.test(value);
}

function wrap(value: string): string {
  const trimmed = value.trim();
  return isAtomic(trimmed) ? trimmed : `(${trimmed})`;
}

function script(value: string, superscript: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (superscript) {
    if (trimmed === "∘" || trimmed === "°") return "°";
    if (trimmed === "′" || trimmed === "'" || trimmed === "′′") return trimmed.replace(/'/g, "′");
  }
  const table = superscript ? SUPERSCRIPTS : SUBSCRIPTS;
  const chars = Array.from(trimmed);
  if (chars.some((char) => char in table) && chars.every((char) => char in table || SCRIPT_PASSTHROUGH.has(char))) {
    return chars.map((char) => table[char] ?? char).join("");
  }
  // No Unicode form: "^(…)" is the plain-text convention for exponents; subscripts simply follow (Keq, Vmax).
  return superscript ? `^${trimmed.length > 1 ? `(${trimmed})` : trimmed}` : trimmed;
}

/** mhchem's \ce{…}: element counts become subscripts, trailing charges superscripts, arrows arrows. */
function chemistry(source: string): string {
  const arrows = source
    .replace(/<=>|<-->|<=>>|<<=>/g, " ⇌ ")
    .replace(/<->/g, " ↔ ")
    .replace(/->/g, " → ")
    .replace(/<-/g, " ← ");
  const counts = arrows.replace(/([A-Za-z)\]])(\d+)/g, (_, base: string, digits: string) => base + script(digits, false));
  const charges = counts.replace(/([A-Za-z\d₀-₉)\]])([+-])(?=\s|$|[),\]])/g, (_, base: string, sign: string) => base + script(sign, true));
  return latexToText(charges).replace(/\s{2,}/g, " ").trim();
}

/**
 * LaTeX math → readable Unicode text. Never throws and always moves forward,
 * so a half-streamed formula simply converts as far as it has arrived.
 */
export function latexToText(source: string): string {
  const src = source;
  const length = src.length;
  let index = 0;

  function skipSpaces() {
    while (index < length && /\s/.test(src[index])) index++;
  }

  /** At "{": the raw inside of the balanced group (or the rest, if it never closes). */
  function readGroup(): string {
    let depth = 0;
    const start = index + 1;
    for (; index < length; index++) {
      const char = src[index];
      if (char === "\\") {
        index++;
        continue;
      }
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          const raw = src.slice(start, index);
          index++;
          return raw;
        }
      }
    }
    return src.slice(start);
  }

  /** At "\": the command's name (letters, or the single symbol after the backslash). */
  function readName(): string {
    index++;
    if (index >= length) return "";
    if (/[a-zA-Z]/.test(src[index])) {
      const start = index;
      while (index < length && /[a-zA-Z]/.test(src[index])) index++;
      return src.slice(start, index);
    }
    return src[index++];
  }

  /** The next argument as raw LaTeX: a {group}, a \command or one character. */
  function readArgument(): string {
    skipSpaces();
    if (index >= length) return "";
    if (src[index] === "{") return readGroup();
    if (src[index] === "\\") {
      const start = index;
      readName();
      return src.slice(start, index);
    }
    return src[index++];
  }

  function readOptional(): string | null {
    skipSpaces();
    if (src[index] !== "[") return null;
    const end = src.indexOf("]", index);
    if (end === -1) return null;
    const raw = src.slice(index + 1, end);
    index = end + 1;
    return raw;
  }

  function command(name: string): string {
    if (!name) return "";
    const literal = lookup(ESCAPED, name) ?? lookup(SYMBOLS, name);
    if (literal !== undefined) {
      if (TIGHT.has(name)) {
        let next = index;
        while (next < length && src[next] === " ") next++;
        if (next < length && /[\p{L}\p{N}]/u.test(src[next])) index = next;
      }
      return literal;
    }
    if (FUNCTIONS.has(name)) {
      // \log\frac{a}{b} reads log(a/b), not log a/b.
      let next = index;
      while (next < length && /\s/.test(src[next])) next++;
      if (/^\\[dtc]?frac(?![a-zA-Z])/.test(src.slice(next, next + 7))) {
        index = next;
        const fraction = command(readName());
        return `${name}(${fraction.replace(/^\((.*)\)$/, "$1")})`;
      }
      return name;
    }
    if (PASS_THROUGH.has(name)) return /style$|^(small|large|Large|footnotesize)$/.test(name) ? "" : latexToText(readArgument());
    if (DROP_WITH_ARGUMENT.has(name)) {
      readArgument();
      return "";
    }
    if (DROP_ALONE.has(name)) return "";
    if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
      const numerator = latexToText(readArgument());
      const denominator = latexToText(readArgument());
      return `${wrap(numerator)}/${wrap(denominator)}`;
    }
    if (name === "sqrt") {
      const degree = readOptional();
      const radicand = latexToText(readArgument());
      return `${degree ? script(latexToText(degree), true) : ""}√${wrap(radicand)}`;
    }
    if (name === "ce" || name === "pu") return chemistry(readArgument());
    const accent = lookup(ACCENTS, name);
    if (accent !== undefined) {
      const base = latexToText(readArgument());
      return Array.from(base).length === 1 ? base + accent : base;
    }
    if (DELIMITER_SIZERS.has(name)) {
      skipSpaces();
      if (index >= length) return "";
      if (src[index] === ".") {
        index++;
        return "";
      }
      if (src[index] === "\\") return command(readName());
      return src[index++];
    }
    if (name === "begin" || name === "end") {
      const environment = readArgument();
      if (name === "begin" && /^(array|tabular)$/.test(environment)) readArgument();
      return "";
    }
    if (name === "textcolor" || name === "colorbox") {
      readArgument();
      return latexToText(readArgument());
    }
    if (name === "xrightarrow" || name === "xleftarrow" || name === "xRightarrow") {
      readOptional();
      const label = latexToText(readArgument()).trim();
      const arrow = name === "xleftarrow" ? "←" : name === "xRightarrow" ? "⇒" : "→";
      return label ? `—${label}${arrow}` : arrow;
    }
    if (name === "overset" || name === "underset" || name === "stackrel") {
      readArgument();
      return latexToText(readArgument());
    }
    if (name === "not") {
      const next = readArgument();
      const negated: Record<string, string> = { "=": "≠", "\\in": "∉", "\\equiv": "≢", "\\subset": "⊄", "<": "≮", ">": "≯" };
      return negated[next] ?? `${latexToText(next)}̸`;
    }
    if (name === "celsius") return "°C";
    // Unknown: keep its argument when it has one, else its name — never the backslash.
    skipSpaces();
    if (src[index] === "{") return latexToText(readGroup());
    return name;
  }

  let out = "";
  while (index < length) {
    const char = src[index];
    if (char === "\\") out += command(readName());
    else if (char === "^" || char === "_") {
      index++;
      out += script(latexToText(readArgument()), char === "^");
    } else if (char === "{") out += latexToText(readGroup());
    else if (char === "}" || char === "&") index++;
    else if (char === "~") {
      out += " ";
      index++;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

// --- Markdown-level cleanup ----------------------------------------------------------

export interface CleanOptions {
  /** Display formulas as ```medart-formula blocks (the chat draws them as cards), or as lines of their own (copy, read-aloud). */
  formulaBlocks?: boolean;
  /** French typography for the screen: narrow no-break spaces before : ; ! ? », curly apostrophes, "…". */
  typography?: boolean;
}

const HOLD_OPEN = "";
const HOLD_CLOSE = "";

function convertProse(text: string, options: Required<CleanOptions>, openEnded: boolean): string {
  const held: string[] = [];
  const hold = (value: string) => `${HOLD_OPEN}${held.push(value) - 1}${HOLD_CLOSE}`;

  // Images written the way the renderer shows them: a caption alone, a link
  // without "!", a bare image URL… (lib/image-markdown-repair.ts). The last
  // line of a reply still arriving waits until it is complete.
  // Inline code stays exactly as written.
  let out = repairImageMarkdown(text, openEnded).replace(/`[^`\n]+`/g, (code) => hold(code));

  // So do links and images: "Blausen_0463_HeartAttack.png" must not become
  // "Blausen₀₄₆₃…", nor "Gray's" "Gray’s" — the link would break. A Wikimedia
  // image name written with spaces gets them as %20 first: a link can't
  // contain a space, and the image would otherwise show as raw text.
  out = out.replace(
    /(!\[[^\]\n]*\]\()(https?:\/\/(?:upload|thumb|commons)\.wikimedia\.org\/(?:[^()\n]|\([^()\n]*\))*?)(\))/gi,
    (_, open: string, url: string, close: string) => `${open}${url.trim().replace(/ /g, "%20")}${close}`
  );
  out = out.replace(/(\]\()((?:[^()\s]|\([^()\s]*\))+)(\))/g, (_, open: string, url: string, close: string) => `${open}${hold(url)}${close}`);
  out = out.replace(/\bhttps?:\/\/[^\s<>()]+/g, (url) => hold(url));

  // Display math. At the start of a line it becomes a block of its own; inside
  // a sentence or an indented list item it stays inline, so the list holds.
  const display = (inner: string, offset: number, whole: string): string => {
    const formula = latexToText(inner)
      .split("\n")
      .map((line) => line.replace(/[ \t ]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    if (!formula) return "";
    const lineStart = whole.lastIndexOf("\n", offset - 1) + 1;
    const ownLine = whole.slice(lineStart, offset).trim() === "";
    const indented = /^[ \t]/.test(whole.slice(lineStart, offset + 1));
    if (!ownLine || indented) return hold(formula.replace(/\n/g, " "));
    return options.formulaBlocks ? `\n\n${hold(`\`\`\`medart-formula\n${formula}\n\`\`\``)}\n\n` : `\n\n${hold(formula)}\n\n`;
  };
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner: string, offset: number, whole: string) => display(inner, offset, whole));
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, inner: string, offset: number, whole: string) => display(inner, offset, whole));
  // Still streaming: an opened display formula converts as far as it has arrived.
  out = out.replace(/\$\$([\s\S]*)$/, (_, inner: string, offset: number, whole: string) => display(inner, offset, whole));
  out = out.replace(/\\\[([\s\S]*)$/, (_, inner: string, offset: number, whole: string) => display(inner, offset, whole));

  // Inline math: \( … \), and $…$ by the usual rule ($ hugging non-space on
  // both sides, no digit right after the closing one), which leaves prices alone.
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, inner: string) => hold(latexToText(inner).trim()));
  out = out.replace(/\\\(([^\n]*)$/, (_, inner: string) => hold(latexToText(inner).trim()));
  out = out.replace(/\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, inner: string) => hold(latexToText(inner).trim()));

  // Bare LaTeX outside any delimiters (\rightarrow, \text{…}, \frac{a}{b}, Ca^{2+}, H_2O…).
  out = out.replace(/\\(textbf|mathbf)\{([^{}\n]*)\}/g, (_, __, inner: string) => `**${latexToText(inner).trim()}**`);
  out = out.replace(/\\(textit|emph)\{([^{}\n]*)\}/g, (_, __, inner: string) => `*${latexToText(inner).trim()}*`);
  out = out.replace(/\\ce\{((?:[^{}\n]|\{[^{}\n]*\})*)\}/g, (_, inner: string) => hold(chemistry(inner)));
  out = out.replace(/\\ce\{([^{}\n]*)$/, (_, inner: string) => hold(chemistry(inner)));
  out = out.replace(
    /\\(?:[dt]?frac|sqrt|text|textrm|mathrm|operatorname|mathit|overline|bar|vec|hat)(?:\[[^\]\n]*\])?(?:\{(?:[^{}\n]|\{[^{}\n]*\})*\}){1,2}/g,
    (match: string) => hold(latexToText(match))
  );
  out = out.replace(/\\([a-zA-Z]+)(?![a-zA-Z])/g, (match: string, name: string) => lookup(SYMBOLS, name) ?? (FUNCTIONS.has(name) ? name : match));
  // Thin spaces only: \! and \: are also plain Markdown escapes outside math.
  out = out.replace(/\\[,;]/g, " ");
  out = out.replace(/\^(?:\{\s*∘\s*\}|∘)/g, "°");
  out = out.replace(/([\p{L}\p{N})\]])\^\{([^{}\n]*)\}/gu, (_, base: string, inner: string) => base + script(latexToText(inner), true));
  out = out.replace(/([\p{L}\p{N})\]])_\{([^{}\n]*)\}/gu, (_, base: string, inner: string) => base + script(latexToText(inner), false));
  out = out.replace(/([\p{L}\p{N})\]])\^(\d*[+\-−]|[+\-−]?\d+)(?![\p{L}\p{N}^])/gu, (_, base: string, power: string) => base + script(power, true));
  out = out.replace(/([A-Za-z)\]])_(\d+)/g, (_, base: string, digits: string) => base + script(digits, false));

  // HTML the renderer would print literally.
  out = out
    .split("\n")
    .map((line) => (/^\s*\|/.test(line) ? line.replace(/<br\s*\/?>/gi, " · ") : line.replace(/\s*<br\s*\/?>\s*/gi, "  \n")))
    .join("\n");
  out = out
    .replace(/<sup>([^<\n]*)<\/sup>/gi, (_, inner: string) => script(inner, true))
    .replace(/<sub>([^<\n]*)<\/sub>/gi, (_, inner: string) => script(inner, false))
    .replace(/<\/?(?:b|strong)>/gi, "**")
    .replace(/<\/?(?:i|em)>/gi, "*")
    .replace(/<\/?u>/gi, "");

  // Markdown the models sometimes get slightly wrong.
  out = out.replace(/^(#{2,6})(?=[^\s#])/gm, "$1 ");
  out = out.replace(/^(\s*)[•●▪◦‣]\s+/gm, "$1- ");

  if (options.typography) {
    out = out
      .replace(/(\S) ([:;!?»])(?=\s|$|[*_)\]])/g, "$1 $2")
      .replace(/« /g, "« ")
      .replace(/(\p{L})'(\p{L})/gu, "$1’$2")
      .replace(/(^|[^.])\.\.\.(?!\.)/g, "$1…");
  }

  out = out.replace(/\n{3,}/g, "\n\n");
  // A held piece can itself contain a held piece (code inside a formula): restore until none is left.
  const placeholder = new RegExp(`${HOLD_OPEN}(\\d+)${HOLD_CLOSE}`, "g");
  for (let pass = 0; pass < 4 && out.includes(HOLD_OPEN); pass++) {
    out = out.replace(placeholder, (_, at: string) => held[Number(at)] ?? "");
  }
  return out;
}

/**
 * The reply's Markdown with LaTeX, stray HTML and near-miss Markdown (images
 * included) made readable. Code is left exactly as written. A text that
 * doesn't end with a line break is taken as still arriving: its last line is
 * not repaired yet (a finished reply is passed with one — StreamedMarkdown).
 */
export function cleanAssistantMarkdown(text: string, { formulaBlocks = true, typography = true }: CleanOptions = {}): string {
  if (!text) return text;
  const options = { formulaBlocks, typography };
  const lines = text.split("\n");
  const openEnded = !text.endsWith("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = (final = false) => {
    if (prose.length) out.push(convertProse(prose.join("\n"), options, final && openEnded));
    prose = [];
  };
  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (fence === null) {
      if (marker) {
        flush();
        fence = marker;
        out.push(line);
      } else prose.push(line);
      continue;
    }
    out.push(line);
    if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
  }
  flush(true);
  return out.join("\n");
}

/**
 * The live (still-arriving) block, tidied for the frame it is shown in: a
 * command or tag cut mid-name ("\righ", "<b") waits for the rest, an image
 * whose description or link is still arriving ("![Schéma du né", "![…](https://upl")
 * appears once complete instead of as raw text, and a "**" still waiting for
 * its partner is closed (see closeOpenEmphasis).
 */
export function tidyLiveBlock(block: string): string {
  return closeOpenEmphasis(block.replace(/(?:\\[a-zA-Z]*|<\/?[a-zA-Z]*)$/, "").replace(/!\[[^\]\n]*(?:\](?:\([^)\n]*)?)?$/, ""));
}

/**
 * A "**" that has opened but not closed yet would show as two stray
 * asterisks until its partner arrives — so it is closed now (the words in
 * progress already render bold), or hidden when nothing follows it yet.
 */
export function closeOpenEmphasis(block: string): string {
  if (/^\s{0,3}(`{3,}|~{3,})/m.test(block)) return block;
  const markers = block.replace(/`[^`\n]*`/g, "").match(/\*\*/g)?.length ?? 0;
  if (markers % 2 === 0) return block;
  const trimmed = block.replace(/\s+$/, "");
  return trimmed.endsWith("**") ? trimmed.slice(0, -2).replace(/\s+$/, "") : `${block}**`;
}
