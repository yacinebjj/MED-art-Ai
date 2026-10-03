"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clock,
  Columns3,
  Copy,
  FileSpreadsheet,
  Info,
  Loader2,
  MessageSquareText,
  Pill,
  RefreshCw,
  Search,
  Sparkles,
  Stethoscope,
  Table2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useAuth } from "@/providers/AuthProvider";
import { buildRateLimitMessage } from "@/lib/rate-limit-message";
import { slugify } from "@/lib/course-generation-shared";
import { cn } from "@/lib/utils";

export type MatrixKind = "pharmaco" | "ddx";

/** Exact shape returned by POST /api/studio/matrix — every row has exactly `columns.length` cells. */
export interface MedicalMatrix {
  kind: MatrixKind;
  title: string;
  columns: string[];
  rows: string[][];
  notes: string[];
}

export interface MedicalMatrixStudioProps {
  courseId: number;
  courseTitle: string;
  onAskInChat?: (prompt: string) => void;
}

interface CachedMatrix {
  generatedAt: string;
  matrix: MedicalMatrix;
}

type PerKind<T> = Record<MatrixKind, T>;

interface SortState {
  column: number;
  direction: "asc" | "desc";
}

interface KindMeta {
  label: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** Mirrors app/api/studio/matrix/route.ts's MATRIX_COLUMNS — only drives the skeleton and preview chips; real headers always come from the response. */
  expectedColumns: string[];
  rowNoun: [singular: string, plural: string];
  loadingLabel: string;
  emptyTitle: string;
  emptyFallback: string;
  fileSlug: string;
}

const MATRIX_KINDS: readonly MatrixKind[] = ["pharmaco", "ddx"];

const KIND_META: Record<MatrixKind, KindMeta> = {
  pharmaco: {
    label: "Pharmacologie",
    icon: Pill,
    title: "Matrice pharmacologique",
    description:
      "Toutes les molécules du cours côte à côte : classe, mécanisme d'action, indications, effets indésirables, contre-indications et remarques pratiques.",
    expectedColumns: [
      "Molécule",
      "Classe",
      "Mécanisme d'action",
      "Indications",
      "Effets indésirables",
      "Contre-indications",
      "Posologie / remarques",
    ],
    rowNoun: ["molécule", "molécules"],
    loadingLabel: "Construction de la matrice pharmacologique à partir du cours…",
    emptyTitle: "Aucune molécule identifiée dans ce cours",
    emptyFallback: "Ce cours ne cite aucun médicament exploitable : aucune ligne n'a été inventée pour remplir le tableau.",
    fileSlug: "pharmaco",
  },
  ddx: {
    label: "Diagnostic différentiel",
    icon: Stethoscope,
    title: "Matrice de diagnostic différentiel",
    description:
      "La pathologie du cours face à ses diagnostics différentiels : terrain, arguments cliniques, examens clés, élément discriminant et piège d'examen.",
    expectedColumns: [
      "Diagnostic",
      "Terrain / contexte",
      "Arguments cliniques",
      "Examens clés",
      "Élément discriminant",
      "Piège d'examen",
    ],
    rowNoun: ["diagnostic", "diagnostics"],
    loadingLabel: "Construction du diagnostic différentiel à partir du cours…",
    emptyTitle: "Pas de diagnostic différentiel exploitable dans ce cours",
    emptyFallback:
      "Ce cours ne se prête pas à un diagnostic différentiel (contenu fondamental) : aucune ligne n'a été inventée pour remplir le tableau.",
    fileSlug: "diagnostic-differentiel",
  },
};

const CACHE_VERSION = 1;

const TEAL_BUTTON =
  "bg-primary-600 text-white hover:bg-primary-700 hover:shadow-glow dark:bg-primary-500 dark:text-primary-950 dark:hover:bg-primary-400";

const ICON_BUTTON =
  "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors " +
  "hover:border-primary-300 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 disabled:pointer-events-none disabled:opacity-50 " +
  "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-700 dark:hover:text-primary-300";

const COLLATOR = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function cacheKey(userId: string, courseId: number, kind: MatrixKind): string {
  return `medart:matrix:${userId}:${courseId}:${kind}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isMedicalMatrix(value: unknown, kind: MatrixKind): value is MedicalMatrix {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { kind?: unknown; title?: unknown; columns?: unknown; rows?: unknown; notes?: unknown };
  if (candidate.kind !== kind || typeof candidate.title !== "string") return false;
  if (!isStringArray(candidate.columns) || candidate.columns.length === 0 || !isStringArray(candidate.notes)) return false;
  const width = candidate.columns.length;
  return Array.isArray(candidate.rows) && candidate.rows.every((row) => isStringArray(row) && row.length === width);
}

function readCachedMatrix(userId: string, courseId: number, kind: MatrixKind): CachedMatrix | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(userId, courseId, kind));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { v, generatedAt, matrix } = parsed as { v?: unknown; generatedAt?: unknown; matrix?: unknown };
    if (v !== CACHE_VERSION || typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) return null;
    return isMedicalMatrix(matrix, kind) ? { generatedAt, matrix } : null;
  } catch {
    return null;
  }
}

function writeCachedMatrix(userId: string, courseId: number, kind: MatrixKind, entry: CachedMatrix): void {
  try {
    window.localStorage.setItem(cacheKey(userId, courseId, kind), JSON.stringify({ v: CACHE_VERSION, ...entry }));
  } catch {
    // Private mode / full storage: the cache is a convenience, the matrix itself is still displayed.
  }
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

/** Accent/case-insensitive form used by the search box ("oedeme" finds "Œdème"). */
function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLowerCase();
}

function isUnspecified(value: string): boolean {
  return /^non pr[ée]cis[ée]/i.test(value.trim());
}

function buildMarkdown(title: string, columns: string[], rows: string[][], notes: string[]): string {
  const escapeCell = (value: string) => (value.trim() ? value : "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = [
    `## ${title}`,
    "",
    `| ${columns.map(escapeCell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ];
  if (notes.length > 0) {
    lines.push("", "**À retenir**", ...notes.map((note) => `- ${note}`));
  }
  return lines.join("\n");
}

/**
 * Semicolon-separated on purpose: French-locale Excel (the default for this
 * app's students) uses ";" as its list separator and would open a
 * comma-separated file as one single column. Every field is quoted, so
 * semicolons/quotes/newlines inside a cell can never shift a column.
 *
 * Cells are AI-generated text: one starting with = + - @ (or a tab/CR) would
 * be evaluated as a formula by Excel/LibreOffice (CSV formula injection), so
 * it gets a leading `'`, which spreadsheets treat as "this is text".
 */
function buildCsv(columns: string[], rows: string[][]): string {
  const quote = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [columns, ...rows].map((row) => row.map(quote).join(";")).join("\r\n");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next ticks rather than synchronously — some browsers start the download asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied permission / insecure context — fall through to the legacy path.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function buildRowPrompt(kind: MatrixKind, courseTitle: string, columns: string[], cells: string[]): string {
  const name = cells[0]?.trim() || "cette ligne";
  const facts = columns
    .slice(1)
    .map((column, index) => {
      const value = cells[index + 1]?.trim();
      return value ? `- ${column} : ${value}` : null;
    })
    .filter((line): line is string => line !== null)
    .join("\n");
  const recap = facts ? `\n${facts}\n` : " (aucun détail renseigné).\n";

  if (kind === "pharmaco") {
    return `Dans mon cours « ${courseTitle} », explique-moi en détail la molécule « ${name} ». Voici ce que ma matrice pharmacologique en retient :${recap}\nDéveloppe le mécanisme d'action, justifie les effets indésirables et les contre-indications à partir de ce mécanisme, et termine par les pièges d'examen classiques sur cette molécule.`;
  }
  return `Dans mon cours « ${courseTitle} », aide-moi à bien maîtriser le diagnostic « ${name} » face à ses diagnostics différentiels. Voici ce que ma matrice en retient :${recap}\nExplique pourquoi l'élément discriminant permet de trancher, détaille le piège d'examen, puis propose-moi un mini cas clinique pour m'entraîner.`;
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return "Connexion au serveur impossible. Vérifie ta connexion puis réessaie.";
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// ---------------------------------------------------------------------------
// Generation requests (module-level, survive remounts)
// ---------------------------------------------------------------------------

type GenerationOutcome = { ok: true; entry: CachedMatrix } | { ok: false; error: string };

const GENERATION_FAILED = "La génération de la matrice a échoué. Réessaie.";

/**
 * Generations in flight, keyed `${userId ?? "anon"}:${courseId}:${kind}`.
 * Module-level on purpose (same idea as ClinicalCaseSimulator's store): the
 * panel remounts when the Studio pane is expanded/collapsed, the Lab tool
 * changes, or the course changes and back. A request owned by component
 * state would be orphaned by that remount — its result never shown — and the
 * student, back on the empty state, would click "Générer" again and pay a
 * second time. So the request outlives the instance that started it, writes
 * the localStorage cache itself, and whichever instance is mounted for that
 * key when it settles adopts the result.
 */
const inFlight = new Map<string, Promise<GenerationOutcome>>();

function inFlightKey(userId: string | null, courseId: number, kind: MatrixKind): string {
  return `${userId ?? "anon"}:${courseId}:${kind}`;
}

async function requestMatrix(userId: string | null, courseId: number, kind: MatrixKind): Promise<GenerationOutcome> {
  try {
    const res = await fetch("/api/studio/matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, kind }),
    });
    const data = ((await res.json().catch(() => null)) ?? {}) as { success?: unknown; error?: unknown; matrix?: unknown };
    if (!res.ok || data.success !== true) {
      throw new Error(
        res.status === 429 ? buildRateLimitMessage(res) : typeof data.error === "string" && data.error ? data.error : GENERATION_FAILED
      );
    }
    if (!isMedicalMatrix(data.matrix, kind)) {
      throw new Error("Réponse inattendue du serveur. Réessaie.");
    }
    const entry: CachedMatrix = { generatedAt: new Date().toISOString(), matrix: data.matrix };
    // Cached even if no instance is mounted any more (or the student switched course): the generation was paid for, it must be there next time.
    if (userId) writeCachedMatrix(userId, courseId, kind, entry);
    return { ok: true, entry };
  } catch (error) {
    return { ok: false, error: describeError(error, GENERATION_FAILED) };
  }
}

/** Returns the generation already in flight for this key, or starts one — never two at once. */
function startGeneration(userId: string | null, courseId: number, kind: MatrixKind): Promise<GenerationOutcome> {
  const key = inFlightKey(userId, courseId, kind);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = requestMatrix(userId, courseId, kind).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function WithTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function IconButton(
  { className, type = "button", ...props },
  ref
) {
  return <button ref={ref} type={type} className={cn(ICON_BUTTON, className)} {...props} />;
});

function ErrorBanner({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200",
        className
      )}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 leading-relaxed">{message}</p>
    </div>
  );
}

function CellValue({ value }: { value: string }) {
  if (!value.trim()) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  if (isUnspecified(value)) return <span className="italic text-slate-400 dark:text-slate-500">{value}</span>;
  return <>{value}</>;
}

function MatrixSkeleton({ columns, label }: { columns: string[]; label: string }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600 dark:text-primary-400" />
        {label}
      </p>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <div className="flex border-b border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
          {columns.map((column) => (
            <div
              key={column}
              className="w-40 shrink-0 truncate px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"
            >
              {column}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className={cn(
              "flex border-b border-slate-100 last:border-b-0 dark:border-slate-800",
              rowIndex % 2 === 1 && "bg-slate-50 dark:bg-slate-900/60"
            )}
          >
            {columns.map((column, columnIndex) => (
              <div key={column} className="w-40 shrink-0 space-y-1.5 px-3 py-3">
                <div
                  className="h-2.5 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700"
                  style={{ width: `${55 + ((rowIndex * 7 + columnIndex * 13) % 40)}%` }}
                />
                {columnIndex > 0 && <div className="h-2.5 w-2/5 animate-pulse rounded-full bg-slate-200/70 dark:bg-slate-700/60" />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatrixEmptyState({
  kind,
  pending,
  error,
  onGenerate,
}: {
  kind: MatrixKind;
  pending: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <div className="glass-card rounded-3xl p-5 shadow-soft dark:shadow-glass-dark">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h4 className="font-heading text-sm font-bold text-foreground">{meta.title}</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{meta.description}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {meta.expectedColumns.map((column) => (
          <span
            key={column}
            className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
          >
            {column}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-col items-start gap-2.5">
        <Button onClick={onGenerate} isLoading={pending} className={TEAL_BUTTON}>
          {!pending && <Sparkles className="h-4 w-4" />}
          Générer la matrice
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Utilise 1 génération du quota de ta formule. La matrice est ensuite conservée sur cet appareil : la rouvrir ne coûte rien.
        </p>
      </div>

      {error && <ErrorBanner className="mt-4" message={error} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generated matrix view (search / sort / columns / export)
// ---------------------------------------------------------------------------

interface MatrixViewProps {
  entry: CachedMatrix;
  courseTitle: string;
  onAskInChat?: (prompt: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  error: string | null;
}

function MatrixView({ entry, courseTitle, onAskInChat, onRegenerate, regenerating, error }: MatrixViewProps) {
  const { matrix, generatedAt } = entry;
  const meta = KIND_META[matrix.kind];
  const MetaIcon = meta.icon;
  const reduceMotion = useReducedMotion();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<number>>(() => new Set());
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Rows mounted in the very first commit fade in; rows that appear later (search cleared, column toggled) don't re-animate.
  const [entranceDone, setEntranceDone] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setEntranceDone(true);
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // The first column is the row's key (molecule / diagnosis) and stays sticky — it can never be hidden.
  const visibleColumns = useMemo(
    () => matrix.columns.map((_, index) => index).filter((index) => index === 0 || !hiddenColumns.has(index)),
    [matrix.columns, hiddenColumns]
  );

  const indexedRows = useMemo(
    () => matrix.rows.map((cells, index) => ({ cells, index, searchable: cells.map(normalizeForSearch) })),
    [matrix.rows]
  );

  const displayedRows = useMemo(() => {
    const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
    let result =
      terms.length === 0
        ? indexedRows
        : indexedRows.filter((row) => terms.every((term) => visibleColumns.some((column) => row.searchable[column].includes(term))));
    if (sort) {
      const { column, direction } = sort;
      result = [...result].sort((a, b) => {
        const left = a.cells[column].trim();
        const right = b.cells[column].trim();
        // Empty cells always sink to the bottom, whatever the direction.
        if (!left || !right) return left ? -1 : right ? 1 : a.index - b.index;
        const comparison = COLLATOR.compare(left, right);
        return (direction === "asc" ? comparison : -comparison) || a.index - b.index;
      });
    }
    return result;
  }, [indexedRows, query, sort, visibleColumns]);

  const exportColumns = visibleColumns.map((column) => matrix.columns[column]);
  const exportRows = displayedRows.map((row) => visibleColumns.map((column) => row.cells[column]));
  const isFiltered = query.trim().length > 0;
  const rowCount = matrix.rows.length;
  const rowNoun = rowCount > 1 ? meta.rowNoun[1] : meta.rowNoun[0];
  const fileBase = `matrice-${meta.fileSlug}-${slugify(courseTitle) || "cours"}`;

  function toggleSort(column: number) {
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: "asc" };
      if (current.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  }

  function toggleColumn(column: number) {
    if (column === 0) return;
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
    setSort((current) => (current && current.column === column ? null : current));
  }

  async function handleCopy() {
    setActionError(null);
    const ok = await copyText(buildMarkdown(matrix.title, exportColumns, exportRows, matrix.notes));
    if (!ok) {
      setActionError("Copie impossible dans ce navigateur. Utilise plutôt l'export CSV.");
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
  }

  function handleExportCsv() {
    setActionError(null);
    try {
      // "﻿" (UTF-8 BOM) is what makes Excel read the file as UTF-8 — without it every accent turns into mojibake.
      downloadBlob(new Blob(["﻿", buildCsv(exportColumns, exportRows)], { type: "text/csv;charset=utf-8" }), `${fileBase}.csv`);
    } catch {
      setActionError("L'export CSV a échoué dans ce navigateur.");
    }
  }

  function sortIcon(column: number) {
    if (!sort || sort.column !== column) return <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40 transition-opacity group-hover/sort:opacity-80" />;
    return sort.direction === "asc" ? (
      <ArrowUp className="h-3 w-3 shrink-0 text-primary-600 dark:text-primary-400" />
    ) : (
      <ArrowDown className="h-3 w-3 shrink-0 text-primary-600 dark:text-primary-400" />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0">
        <h4 className="font-heading text-sm font-bold leading-snug text-foreground">{matrix.title}</h4>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {rowCount} {rowNoun}
          </span>
          {generatedAt && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Généré le {formatGeneratedAt(generatedAt)}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {rowCount > 0 && (
          <>
            <label className="relative min-w-[10rem] flex-1">
              <span className="sr-only">Rechercher dans la matrice</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                inputMode="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher dans la matrice…"
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-8 text-sm text-foreground shadow-sm outline-none transition-shadow placeholder:text-slate-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-500/30 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-primary-600"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Effacer la recherche"
                  className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </label>

            <DropdownMenu>
              <WithTooltip label="Colonnes affichées">
                <DropdownMenuTrigger asChild>
                  <IconButton aria-label="Choisir les colonnes affichées">
                    <Columns3 className="h-4 w-4" />
                    {hiddenColumns.size > 0 && (
                      <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white dark:bg-primary-500 dark:text-primary-950">
                        {matrix.columns.length - hiddenColumns.size}
                      </span>
                    )}
                  </IconButton>
                </DropdownMenuTrigger>
              </WithTooltip>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Colonnes affichées</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {matrix.columns.map((column, index) => (
                  <DropdownMenuCheckboxItem
                    key={column}
                    checked={index === 0 || !hiddenColumns.has(index)}
                    disabled={index === 0}
                    onCheckedChange={() => toggleColumn(index)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {column}
                  </DropdownMenuCheckboxItem>
                ))}
                {hiddenColumns.size > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        setHiddenColumns(new Set());
                      }}
                    >
                      Tout afficher
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <WithTooltip label={copied ? "Copié !" : "Copier le tableau affiché (Markdown)"}>
              <IconButton onClick={handleCopy} aria-label="Copier le tableau en Markdown">
                {copied ? <Check className="h-4 w-4 text-primary-600 dark:text-primary-400" /> : <Copy className="h-4 w-4" />}
              </IconButton>
            </WithTooltip>

            <WithTooltip label="Exporter le tableau affiché en CSV (Excel)">
              <IconButton onClick={handleExportCsv} aria-label="Exporter en CSV">
                <FileSpreadsheet className="h-4 w-4" />
              </IconButton>
            </WithTooltip>
          </>
        )}

        <WithTooltip label="Régénérer (utilise 1 génération)">
          <IconButton
            onClick={() => setConfirmingRegenerate(true)}
            disabled={regenerating}
            aria-label="Régénérer la matrice"
            className={cn(rowCount === 0 && "ml-auto")}
          >
            <RefreshCw className={cn("h-4 w-4", regenerating && "animate-spin")} />
          </IconButton>
        </WithTooltip>
      </div>

      <AnimatePresence initial={false}>
        {confirmingRegenerate && !regenerating && (
          <motion.div
            key="confirm"
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <p className="min-w-[12rem] flex-1 leading-relaxed">
                Régénérer remplace cette matrice et utilise 1 génération du quota de ta formule.
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setConfirmingRegenerate(false)}>
                  Annuler
                </Button>
                <Button
                  size="sm"
                  className={TEAL_BUTTON}
                  onClick={() => {
                    setConfirmingRegenerate(false);
                    onRegenerate();
                  }}
                >
                  Régénérer
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {regenerating && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-2xl border border-primary-200 bg-primary-50/70 px-3 py-2 text-xs font-medium text-primary-800 dark:border-primary-900/60 dark:bg-primary-950/30 dark:text-primary-200"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Régénération en cours — la matrice actuelle reste affichée en attendant.
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      {actionError && <ErrorBanner message={actionError} />}

      {rowCount === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <MetaIcon className="h-5 w-5" />
          </span>
          <h5 className="mt-3 font-heading text-sm font-bold text-foreground">{meta.emptyTitle}</h5>
          <div className="mx-auto mt-2 max-w-md space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            {matrix.notes.length > 0 ? matrix.notes.map((note, index) => <p key={index}>{note}</p>) : <p>{meta.emptyFallback}</p>}
          </div>
        </div>
      ) : (
        <>
          <div
            className={cn(
              "relative max-h-[min(70vh,640px)] overflow-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-soft transition-opacity dark:border-slate-800 dark:bg-slate-900",
              regenerating && "opacity-70"
            )}
          >
            <table className="w-max min-w-full border-separate border-spacing-0 text-left text-[13px] leading-snug">
              <caption className="sr-only">{matrix.title}</caption>
              <thead>
                <tr>
                  {visibleColumns.map((column, position) => {
                    const sorted = sort?.column === column;
                    return (
                      <th
                        key={column}
                        scope="col"
                        aria-sort={sorted ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                        className={cn(
                          "sticky top-0 z-20 border-b border-slate-200 bg-slate-100 p-0 align-bottom text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
                          position === 0 && "left-0 z-30 border-r border-r-slate-200 dark:border-r-slate-700",
                          sorted && "text-primary-700 dark:text-primary-300"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          aria-label={`Trier par ${matrix.columns[column]}`}
                          className="group/sort flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left uppercase tracking-wide transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/60 dark:hover:text-primary-300"
                        >
                          <span>{matrix.columns[column]}</span>
                          {sortIcon(column)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((row, position) => {
                  const zebra = position % 2 === 1;
                  return (
                    <motion.tr
                      key={row.index}
                      className="group"
                      initial={entranceDone || reduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25, delay: Math.min(position, 16) * 0.03 }}
                    >
                      {visibleColumns.map((column, columnPosition) => {
                        const value = row.cells[column];
                        const isKey = columnPosition === 0;
                        return (
                          <td
                            key={column}
                            className={cn(
                              "border-b border-slate-100 px-3 py-2.5 align-top text-slate-700 transition-colors dark:border-slate-800 dark:text-slate-300",
                              zebra ? "bg-slate-50 dark:bg-[#131c2f]" : "bg-white dark:bg-slate-900",
                              "group-hover:bg-primary-50 dark:group-hover:bg-[#0f2a2d]",
                              isKey &&
                                "sticky left-0 z-10 border-r border-r-slate-200 font-semibold text-slate-900 shadow-[6px_0_8px_-6px_rgb(15_23_42/0.15)] dark:border-r-slate-700 dark:text-slate-50"
                            )}
                          >
                            {isKey ? (
                              <div className="flex min-w-[8.5rem] max-w-[12rem] items-start justify-between gap-2">
                                <span className="break-words">{value}</span>
                                {onAskInChat && (
                                  <WithTooltip label="Demander à MedArt">
                                    <button
                                      type="button"
                                      onClick={() => onAskInChat(buildRowPrompt(matrix.kind, courseTitle, matrix.columns, row.cells))}
                                      aria-label={`Demander à MedArt : ${value}`}
                                      className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-slate-400 opacity-70 transition hover:bg-primary-100 hover:text-primary-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 group-hover:opacity-100 dark:hover:bg-primary-950 dark:hover:text-primary-300"
                                    >
                                      <MessageSquareText className="h-3.5 w-3.5" />
                                    </button>
                                  </WithTooltip>
                                )}
                              </div>
                            ) : (
                              <div className="min-w-[11rem] max-w-[17rem] break-words">
                                <CellValue value={value} />
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
            {displayedRows.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune ligne ne correspond à « {query.trim()} ».</p>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {isFiltered ? `${displayedRows.length} / ${rowCount} lignes affichées · ` : ""}
            Clique sur un en-tête pour trier · fais défiler le tableau horizontalement pour voir toutes les colonnes.
          </p>
        </>
      )}

      {rowCount > 0 && matrix.notes.length > 0 && (
        <div className="rounded-2xl border border-primary-200/70 bg-primary-50/50 p-3.5 dark:border-primary-900/50 dark:bg-primary-950/20">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">
            <Info className="h-3.5 w-3.5" />À retenir
          </p>
          <ul className="mt-2 space-y-1.5">
            {matrix.notes.map((note, index) => (
              <li key={index} className="flex gap-2 text-sm leading-relaxed text-foreground">
                <span className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * "Matrice Pharmaco / Diagnostic différentiel" — a dense, sortable,
 * exportable revision table generated on demand from one course (see
 * app/api/studio/matrix/route.ts). Each generation costs one unit of the
 * plan's monthly quota, so every result is cached per student/course/kind
 * in localStorage and reopening the panel never re-spends anything.
 */
export function MedicalMatrixStudio({ courseId, courseTitle, onAskInChat }: MedicalMatrixStudioProps) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const reduceMotion = useReducedMotion();
  const segmentId = useId();

  const [kind, setKind] = useState<MatrixKind>("pharmaco");
  const [entries, setEntries] = useState<PerKind<CachedMatrix | null>>({ pharmaco: null, ddx: null });
  const [pending, setPending] = useState<PerKind<boolean>>({ pharmaco: false, ddx: false });
  const [errors, setErrors] = useState<PerKind<string | null>>({ pharmaco: null, ddx: null });
  const [cacheReady, setCacheReady] = useState(false);

  // Guards against a response for a previous course/user landing in the current view.
  const scope = `${userId ?? "anonyme"}:${courseId}`;
  const scopeRef = useRef(scope);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Shows `target` as generating until `promise` (from startGeneration —
   * started by this instance or left running by a previous mount) settles,
   * then displays its result — only if this instance is still mounted and
   * still on the same course/user. The result is stored per kind, so
   * switching tab meanwhile is fine.
   */
  const adopt = useCallback((target: MatrixKind, promise: Promise<GenerationOutcome>) => {
    const requestScope = scopeRef.current;
    setPending((current) => ({ ...current, [target]: true }));
    setErrors((current) => ({ ...current, [target]: null }));
    void promise.then((outcome) => {
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      if (outcome.ok) setEntries((current) => ({ ...current, [target]: outcome.entry }));
      else setErrors((current) => ({ ...current, [target]: outcome.error }));
      setPending((current) => ({ ...current, [target]: false }));
    });
  }, []);

  useEffect(() => {
    scopeRef.current = scope;
    if (authLoading) {
      setCacheReady(false);
      return;
    }
    setEntries({
      pharmaco: userId ? readCachedMatrix(userId, courseId, "pharmaco") : null,
      ddx: userId ? readCachedMatrix(userId, courseId, "ddx") : null,
    });
    setPending({ pharmaco: false, ddx: false });
    setErrors({ pharmaco: null, ddx: null });
    setCacheReady(true);
    // A generation started before a remount (or before switching course and
    // back) is still running: show it as such and pick up its result rather
    // than offering — and charging — a second one.
    for (const target of MATRIX_KINDS) {
      const running = inFlight.get(inFlightKey(userId, courseId, target));
      if (running) adopt(target, running);
    }
  }, [adopt, authLoading, courseId, scope, userId]);

  const generate = useCallback(
    (target: MatrixKind) => {
      // startGeneration hands back the running request if there is one, so a double click never pays twice.
      adopt(target, startGeneration(userId, courseId, target));
    },
    [adopt, courseId, userId]
  );

  const meta = KIND_META[kind];
  const entry = entries[kind];

  let content: ReactNode;
  if (!cacheReady) {
    content = <MatrixSkeleton columns={meta.expectedColumns} label="Chargement de ta matrice…" />;
  } else if (entry) {
    content = (
      <MatrixView
        key={`${kind}:${entry.generatedAt}`}
        entry={entry}
        courseTitle={courseTitle}
        onAskInChat={onAskInChat}
        onRegenerate={() => generate(kind)}
        regenerating={pending[kind]}
        error={errors[kind]}
      />
    );
  } else if (pending[kind]) {
    content = <MatrixSkeleton columns={meta.expectedColumns} label={meta.loadingLabel} />;
  } else {
    content = <MatrixEmptyState kind={kind} pending={pending[kind]} error={errors[kind]} onGenerate={() => generate(kind)} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-glow">
          <Table2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="font-heading text-base font-bold leading-tight text-foreground">Matrices de révision</h3>
          <p className="truncate text-xs text-muted-foreground">{courseTitle}</p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Type de matrice"
        className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900/70"
      >
        {MATRIX_KINDS.map((option) => {
          const active = option === kind;
          const OptionIcon = KIND_META[option].icon;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              id={`${segmentId}-tab-${option}`}
              aria-selected={active}
              aria-controls={`${segmentId}-panel`}
              onClick={() => setKind(option)}
              className={cn(
                "relative isolate flex min-w-0 items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-center text-[13px] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60",
                active ? "text-primary-800 dark:text-primary-200" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              {active && (
                <motion.span
                  layoutId={`${segmentId}-indicator`}
                  className="absolute inset-0 -z-10 rounded-xl bg-white shadow-soft dark:bg-slate-800"
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <OptionIcon className="h-4 w-4 shrink-0" />
              <span>{KIND_META[option].label}</span>
              {pending[option] ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-label="Génération en cours" />
              ) : entries[option] ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" aria-label="Matrice disponible" />
              ) : null}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={kind}
          id={`${segmentId}-panel`}
          role="tabpanel"
          aria-labelledby={`${segmentId}-tab-${kind}`}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="min-w-0"
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
