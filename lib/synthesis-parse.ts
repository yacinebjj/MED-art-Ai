/**
 * Read-only parsing of the Module Synthesis Markdown produced by
 * lib/module-synthesis.ts (never changed by this module):
 *  - global_summary:     "## <emoji> Course" chunks + a final "### 🔗 Synthèse Transversale"
 *  - medical_dictionary: "## 📖 Course" chunks, each a "| Terme | Explication clinique | الشرح بالعربية |" table
 *  - keywords_table:     one "| Cours | <category> | … |" table, cells "**kw:** explanation • …"
 * Anything that does not match is kept as a plain section — content is never dropped.
 */

export type SynthesisKind = "global_summary" | "keywords_table" | "medical_dictionary";
export type Priority = "essentiel" | "important" | "standard";

export interface SynthesisSection {
  id: string;
  title: string;
  body: string;
  isCrossCourse: boolean;
}

export interface DictionaryEntry {
  id: string;
  term: string;
  fr: string;
  ar: string;
  course: string;
  priority: Priority;
  mentions: number;
}

export interface KeywordItem {
  id: string;
  course: string;
  category: string;
  keyword: string;
  explanation: string;
  priority: Priority;
  courses: number;
}

export function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*|__|`/g, "").replace(/^\s*[*_]|[*_]\s*$/g, "").trim();
}

export function detectSynthesisKind(markdown: string): SynthesisKind {
  if (/^\s*\|\s*Cours\s*\|/m.test(markdown) && !/^##\s/m.test(markdown)) return "keywords_table";
  if (/\|\s*Terme\s*\|/i.test(markdown)) return "medical_dictionary";
  return "global_summary";
}

export function parseSections(markdown: string): SynthesisSection[] {
  const sections: { title: string | null; body: string[] }[] = [];
  for (const line of markdown.split("\n")) {
    // A new card starts at a course heading ("## …") or at the cross-course
    // synthesis ("### 🔗 Synthèse Transversale"); a course's own "### "
    // sub-headings stay inside its card.
    const match = line.match(/^##\s+(.+?)\s*$/) ?? line.match(/^###\s+((?:🔗|.*synth[eè]se transversale).*?)\s*$/i);
    if (match) sections.push({ title: match[1].trim(), body: [] });
    else if (sections.length > 0) sections[sections.length - 1].body.push(line);
    else sections.push({ title: null, body: [line] });
  }
  return sections
    .map((s, i) => ({
      id: `s${i}`,
      title: s.title ?? "",
      body: s.body.join("\n").replace(/^\s*-{3,}\s*$/gm, "").trim(),
      isCrossCourse: /synthèse transversale|🔗/i.test(s.title ?? ""),
    }))
    .filter((s) => s.body.length > 0 || s.title);
}

/** Data rows of every Markdown table in `text` (header and separator rows skipped). */
export function parseTableRows(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l));
  // An escaped "\|" inside a cell is content, not a separator.
  const PLACEHOLDER = "<<pipe>>";
  const split = (l: string) =>
    l
      .trim()
      .split("\\|")
      .join(PLACEHOLDER)
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.split(PLACEHOLDER).join("|").trim());
  if (lines.length === 0) return { header: [], rows: [] };
  const header = split(lines[0]);
  const rows = lines
    .slice(1)
    .filter((l) => !/^\s*\|\s*:?-{3,}/.test(l))
    .map(split)
    .filter((cells) => cells.some((c) => c && c !== "-"));
  return { header, rows };
}

/** Course title without its leading emoji. */
export function cleanCourseTitle(title: string): string {
  return title.replace(/^[^A-Za-z0-9\u00C0-\u024F\u0600-\u06FF]+/, "").trim() || title;
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length < 3) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * Importance is COMPUTED, never invented: how widely the term recurs across
 * the student's selected courses (defined in ≥ 2 courses, or mentioned ≥ 3
 * times in the whole synthesis → essentiel; mentioned twice → important).
 */
function priorityFrom(courses: number, mentions: number): Priority {
  if (courses >= 2 || mentions >= 3) return "essentiel";
  if (mentions >= 2) return "important";
  return "standard";
}

export function parseDictionary(markdown: string): { entries: DictionaryEntry[]; extras: SynthesisSection[] } {
  const sections = parseSections(markdown);
  const raw: Omit<DictionaryEntry, "priority" | "mentions">[] = [];
  const extras: SynthesisSection[] = [];
  for (const section of sections) {
    const { rows } = parseTableRows(section.body);
    if (section.isCrossCourse || rows.length === 0) {
      extras.push(section);
      continue;
    }
    const course = cleanCourseTitle(section.title);
    rows.forEach((cells, i) => {
      const term = stripInlineMarkdown(cells[0] ?? "");
      if (!term) return;
      raw.push({ id: `${section.id}-${i}`, term, fr: cells[1] ?? "", ar: cells[2] ?? "", course });
    });
  }
  const corpus = normalizeKey(markdown);
  const coursesByTerm = new Map<string, Set<string>>();
  for (const e of raw) {
    const key = normalizeKey(e.term);
    coursesByTerm.set(key, (coursesByTerm.get(key) ?? new Set()).add(e.course));
  }
  const entries = raw.map((e) => {
    const key = normalizeKey(e.term);
    const mentions = countOccurrences(corpus, key);
    return { ...e, mentions, priority: priorityFrom(coursesByTerm.get(key)?.size ?? 1, mentions) };
  });
  return { entries, extras };
}

export function parseKeywords(markdown: string): { items: KeywordItem[]; categories: string[]; courses: string[] } {
  const { header, rows } = parseTableRows(markdown);
  const categories = header.slice(1).map((c) => stripInlineMarkdown(c));
  const raw: Omit<KeywordItem, "priority" | "courses">[] = [];
  rows.forEach((cells, r) => {
    const course = stripInlineMarkdown(cells[0] ?? "");
    cells.slice(1).forEach((cell, c) => {
      if (!cell || cell === "-") return;
      cell.split(/\s+•\s+/).forEach((piece, k) => {
        const m = piece.match(/^\s*\*\*(.+?)\*\*\s*:?\s*(.*)$/) ?? piece.match(/^\s*([^:]{2,80}):\s*(.*)$/);
        const keyword = stripInlineMarkdown(m ? m[1].replace(/:$/, "") : piece);
        const explanation = stripInlineMarkdown(m ? m[2] : "");
        if (keyword) raw.push({ id: `${r}-${c}-${k}`, course, category: categories[c] ?? "Autre", keyword, explanation });
      });
    });
  });
  const coursesByKeyword = new Map<string, Set<string>>();
  for (const item of raw) {
    const key = normalizeKey(item.keyword);
    coursesByKeyword.set(key, (coursesByKeyword.get(key) ?? new Set()).add(item.course));
  }
  const corpus = normalizeKey(markdown);
  const items = raw.map((item) => {
    const key = normalizeKey(item.keyword);
    const courses = coursesByKeyword.get(key)?.size ?? 1;
    return { ...item, courses, priority: priorityFrom(courses, countOccurrences(corpus, key)) };
  });
  return { items, categories: categories.filter((cat) => items.some((i) => i.category === cat)), courses: [...new Set(items.map((i) => i.course))] };
}

export function matchesQuery(query: string, ...fields: string[]): boolean {
  const q = normalizeKey(query);
  if (!q) return true;
  return fields.some((f) => normalizeKey(f).includes(q));
}
