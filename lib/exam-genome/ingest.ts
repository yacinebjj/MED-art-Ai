import { createHash } from "crypto";
import { extractPdfTextViaOcr } from "@/lib/ai/openrouter";
import { extractPdfTextLayer } from "@/lib/document-extraction";
import { getBlidaUnit, yearLabel } from "@/lib/exam-genome/blida-catalog";
import { loadPaperQuestions, loadUnitPapers, raiseDbError, type Admin } from "@/lib/exam-genome/db";
import { GenomeIngestError, type ContributionOutcome } from "@/lib/exam-genome/errors";
import { SAME_PAPER_RATIO, matchQuestions, paperOverlap, questionPrint, type QuestionPrint } from "@/lib/exam-genome/fingerprint";
import { detectPaperScope, findExamDate, normalizeAcademicYear, resolveUnit, type PaperScope } from "@/lib/exam-genome/normalize";
import { parseExamText, type ParsedExam, type ParsedQuestion } from "@/lib/exam-genome/parse";
import {
  GenomePaperMetaSchema,
  GenomeQuestionSchema,
  isLegacyProgramme,
  maxTrustForSource,
  type GenomePaperMeta,
  type GenomeProvenance,
  type GenomeSession,
  type KeySource,
} from "@/lib/exam-genome/scope";
import type { GenomeSitting } from "@/lib/exam-genome/blida-catalog";
import { GENOME_BUCKET, type GenomeMimeType } from "@/lib/exam-genome/storage";
import { isAnswerValidForFormat, resolveEffectiveKey } from "@/lib/exam-genome/trust";

/**
 * EXAM GENOME — one uploaded file → one stored paper, or a precise refusal.
 *
 *   1. the file: same bytes already stored (sha256) → refused as a duplicate;
 *   2. the text: the PDF's own text layer; OCR (mistral-ocr) when the layer is
 *      empty, a scan, or a two-column page read line by line — the better of
 *      the two parses wins; a photo becomes a one-page PDF first;
 *   3. the questions (lib/exam-genome/parse.ts) — not an exam → refused;
 *   4. the scope, from the paper's own header: another faculty, pharmacy,
 *      dentistry, veterinary medicine → refused and the file deleted;
 *   5. the metadata: what the contributor declared, checked against the
 *      header (a 3rd-year unit on a 2nd-year header is refused), validated by
 *      the strict GenomePaperMetaSchema;
 *   6. duplicates: every question is compared with the unit's stored ones —
 *      the same question asked another year joins its family; a paper that
 *      repeats ≥ 60 % of a stored paper of the same slot is filed as its
 *      duplicate;
 *   7. the key the document carries (grid, "Réponse :", corrigé-type marks),
 *      at the trust its provenance allows;
 *   8. one transaction (eg_ingest_paper): paper, file, questions, keys.
 * Everything lands as needs_review: nothing reaches students before a reviewer.
 */

export { GenomeIngestError, type ContributionOutcome } from "@/lib/exam-genome/errors";

export interface DeclaredMeta {
  unitCode?: string | null;
  academicYear?: string | null;
  session?: GenomeSession | null;
  sitting?: GenomeSitting | null;
  rotation?: number | null;
  variant?: string | null;
  examDate?: string | null;
  durationMinutes?: number | null;
  provenance?: GenomeProvenance | null;
  notes?: string | null;
}

export interface IngestInput {
  supabase: Admin;
  userId: string;
  isAdmin: boolean;
  storagePath: string;
  fileName: string;
  mimeType: GenomeMimeType;
  declared: DeclaredMeta;
  /** Epoch ms after which no new slow step (OCR) starts. */
  deadline: number;
}

export interface IngestResult {
  paperId: string;
  status: "needs_review" | "duplicate";
  duplicateOf: string | null;
  meta: GenomePaperMeta;
  scope: Pick<PaperScope, "verdict" | "reasons">;
  extraction: "text_layer" | "ocr";
  stats: ParsedExam["stats"];
  storedAsUnreadable: number;
  keysFromDocument: number;
  keyLevel: number | null;
  recurringQuestions: number;
  warnings: string[];
}

const TEXT_LAYER_TIMEOUT_MS = 60_000;
const OCR_TIMEOUT_MS = 150_000;
const MIN_OCR_WINDOW_MS = 25_000;
const OCR_SIGNED_URL_TTL_S = 600;
/** Below this many non-blank characters per page, a PDF is a scan with at most a typed header. */
const MIN_TEXT_CHARS_PER_PAGE = 150;

const contentChars = (text: string) => text.replace(/\s+/g, "").length;

/** "Durée : 1h30", "Durée = 1 h 45", "Durée : 60 minutes", "01 Heure" → minutes. */
export function findDuration(text: string): number | null {
  const m = text.match(/dur[ée]e\s*[:=]?\s*(\d{1,2})\s*(?:h|heures?)\s*(\d{1,2})?|dur[ée]e\s*[:=]?\s*(\d{2,3})\s*(?:min|minutes|mn)\b|\b(0?[1-4])\s*heures?\b/i);
  if (!m) return null;
  if (m[3]) return Number(m[3]);
  const hours = Number(m[1] ?? m[4]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const total = hours * 60 + minutes;
  return total >= 10 && total <= 480 ? total : null;
}

/** How good a parse is: complete questions first, then mean confidence. */
function parseScore(exam: ParsedExam): number {
  return exam.stats.complete + exam.stats.meanConfidence;
}

async function ocrText(supabase: Admin, path: string, fileName: string, deadline: number): Promise<string | null> {
  const timeoutMs = Math.min(OCR_TIMEOUT_MS, deadline - Date.now());
  if (timeoutMs < MIN_OCR_WINDOW_MS) return null;
  const { data: signed, error } = await supabase.storage.from(GENOME_BUCKET).createSignedUrl(path, OCR_SIGNED_URL_TTL_S);
  if (error || !signed?.signedUrl) throw new Error(`URL signée indisponible : ${error?.message ?? "réponse vide"}`);
  const { text } = await extractPdfTextViaOcr(signed.signedUrl, fileName.replace(/\.(png|jpe?g)$/i, ".pdf"), { timeoutMs });
  return text;
}

/** A photo of a paper as a one-page PDF, so that the same OCR reads it. */
async function imageToPdf(bytes: Buffer): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const image = new Uint8Array(bytes);
  const props = doc.getImageProperties(image);
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const scale = Math.min(width / props.width, height / props.height);
  doc.addImage(image, props.fileType, 0, 0, props.width * scale, props.height * scale);
  return Buffer.from(doc.output("arraybuffer"));
}

interface Extraction {
  exam: ParsedExam;
  text: string;
  method: "text_layer" | "ocr";
  pages: number | null;
}

async function extractExam(input: IngestInput, bytes: Buffer): Promise<Extraction> {
  const { supabase, storagePath, fileName, deadline } = input;
  if (input.mimeType !== "application/pdf") {
    const pdfPath = `${storagePath}.ocr.pdf`;
    const pdf = await imageToPdf(bytes);
    const { error } = await supabase.storage.from(GENOME_BUCKET).upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`Préparation de l'image pour l'OCR impossible : ${error.message}`);
    try {
      const text = await ocrText(supabase, pdfPath, fileName, deadline);
      if (!text || contentChars(text) < 200) throw new GenomeIngestError("Photo illisible : aucun texte d'examen n'a pu être lu. Reprends-la bien à plat, nette et éclairée.", 422, "unreadable");
      return { exam: parseExamText(text), text, method: "ocr", pages: 1 };
    } finally {
      await supabase.storage.from(GENOME_BUCKET).remove([pdfPath]);
    }
  }

  let layer: Extraction | null = null;
  try {
    const { text, pages } = await extractPdfTextLayer(bytes, TEXT_LAYER_TIMEOUT_MS);
    if (contentChars(text) >= 200 && (pages === null || contentChars(text) / pages >= MIN_TEXT_CHARS_PER_PAGE)) {
      layer = { exam: parseExamText(text), text, method: "text_layer", pages };
    }
  } catch (error) {
    console.warn("[exam-genome/ingest] Couche texte illisible — passage à l'OCR :", error instanceof Error ? error.message : error);
  }
  // A clean text layer is the most faithful reading: OCR only when it is missing or reads badly (two columns, holes).
  if (layer && layer.exam.stats.looksLikeExam && !layer.exam.stats.layoutSuspect) return layer;
  let ocr: Extraction | null = null;
  try {
    const text = await ocrText(supabase, storagePath, fileName, deadline);
    if (text && contentChars(text) >= 200) ocr = { exam: parseExamText(text), text, method: "ocr", pages: layer?.pages ?? null };
  } catch (error) {
    console.warn("[exam-genome/ingest] OCR échoué :", error instanceof Error ? error.message : error);
  }
  const best = [layer, ocr].filter((x): x is Extraction => Boolean(x)).sort((a, b) => parseScore(b.exam) - parseScore(a.exam))[0];
  if (!best) throw new GenomeIngestError("Document illisible : ni la couche texte du PDF ni l'OCR n'ont donné de texte d'examen.", 422, "unreadable");
  return best;
}

/** Declared metadata, checked against what the header says, then validated by the strict schema. */
function resolveMeta(input: IngestInput, scope: PaperScope, header: string): { meta: GenomePaperMeta; warnings: string[] } {
  const { declared } = input;
  const warnings: string[] = [];
  const problems: string[] = [];

  let unit = declared.unitCode ? getBlidaUnit(declared.unitCode) : undefined;
  if (declared.unitCode && !unit) problems.push(`Unité inconnue : ${declared.unitCode}.`);
  if (unit && scope.yearLevel && scope.yearLevel !== unit.year) {
    problems.push(`L'en-tête indique la ${yearLabel(scope.yearLevel)}, mais « ${unit.title} » est une unité de ${yearLabel(unit.year)}.`);
  }
  if (!unit && !declared.unitCode) {
    if (!scope.yearLevel) problems.push("Année d'étude introuvable dans l'en-tête : précise l'unité du sujet.");
    else {
      const match = resolveUnit(scope.yearLevel, header);
      if (match) {
        unit = match.unit;
        warnings.push(`Unité déduite de l'en-tête : ${unit.title}.`);
      } else problems.push(`Unité introuvable dans l'en-tête (${yearLabel(scope.yearLevel)}) : précise-la.`);
    }
  }

  const declaredYear = declared.academicYear ? normalizeAcademicYear(declared.academicYear) ?? declared.academicYear : null;
  if (declaredYear && scope.academicYear && declaredYear !== scope.academicYear) {
    problems.push(`Année universitaire déclarée ${declaredYear}, mais l'en-tête indique ${scope.academicYear}.`);
  }
  const academicYear = declaredYear ?? scope.academicYear;
  if (!academicYear) problems.push("Année universitaire introuvable dans l'en-tête : précise-la (ex. 2023/2024).");

  let provenance: GenomeProvenance = declared.provenance ?? "student_copy";
  if (!input.isAdmin && (provenance === "official" || provenance === "teacher")) {
    warnings.push("Provenance « officielle » réservée à l'équipe : enregistré comme copie d'étudiant.");
    provenance = "student_copy";
  }
  if (problems.length || !unit || !academicYear) {
    throw new GenomeIngestError(problems.join(" ") || "Métadonnées incomplètes.", 422, "rejected", { problems });
  }

  const candidate = {
    faculty: "blida1_medecine",
    track: "medecine",
    yearLevel: unit.year,
    unitCode: unit.code,
    academicYear,
    session: declared.session ?? scope.session,
    sitting: declared.sitting ?? (declared.session === "rattrapage" || scope.session === "rattrapage" ? "unique" : scope.sitting),
    rotation: declared.rotation ?? null,
    variant: declared.variant?.trim() || null,
    examDate: declared.examDate ?? findExamDate(header),
    durationMinutes: declared.durationMinutes ?? findDuration(header),
    provenance,
  };
  const parsed = GenomePaperMetaSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message);
    throw new GenomeIngestError(issues.join(" "), 422, "rejected", { problems: issues });
  }
  return { meta: parsed.data, warnings };
}

interface StoredDraft {
  position: number;
  format: ParsedQuestion["format"];
  polarity: ParsedQuestion["polarity"];
  context: string | null;
  stem: string;
  propositions: string[];
  options: { label: string; text: string }[];
  parseConfidence: number;
  parseIssues: string[];
  print: QuestionPrint;
}

/** A question the schema refuses (3 options read…) is kept for a reviewer as "à relire", never shown to students. */
function toDraft(q: ParsedQuestion): { draft: StoredDraft; unreadable: boolean } {
  const base = {
    position: q.position,
    format: q.format,
    polarity: q.polarity,
    context: q.context ? q.context.slice(0, 8000) : null,
    stem: q.stem.slice(0, 4000),
    propositions: q.propositions.slice(0, 8).map((p) => p.slice(0, 1200)),
    options: q.options.slice(0, 5).map((o) => ({ label: o.label, text: o.text.slice(0, 1200) })),
    parseConfidence: q.confidence,
  };
  const checked = GenomeQuestionSchema.safeParse(base);
  const print = questionPrint(base);
  if (checked.success) return { draft: { ...base, parseIssues: q.issues, print }, unreadable: false };
  return {
    draft: {
      ...base,
      format: "qroc",
      stem: base.stem.length >= 8 || base.context ? base.stem : `(énoncé illisible) ${base.stem}`.trim(),
      parseConfidence: Math.min(q.confidence, 0.4),
      parseIssues: [...q.issues, `à relire : ${checked.error.issues[0]?.message ?? "question incomplète"}`],
      print,
    },
    unreadable: true,
  };
}

function keySourceFor(provenance: GenomeProvenance): KeySource {
  if (provenance === "official") return "official_grid";
  if (provenance === "teacher") return "teacher";
  return "student_document";
}

export async function ingestPaper(input: IngestInput): Promise<IngestResult> {
  const { supabase, userId, storagePath } = input;

  // 1. The file.
  const { data: blob, error: downloadError } = await supabase.storage.from(GENOME_BUCKET).download(storagePath);
  if (downloadError || !blob) throw new GenomeIngestError("Fichier introuvable : renvoie-le.", 404, "rejected");
  const bytes = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: known, error: knownError } = await supabase.from("eg_sources").select("paper_id").eq("sha256", sha256).maybeSingle();
  if (knownError) raiseDbError(knownError, "recherche du fichier");
  if (known) throw new GenomeIngestError("Ce fichier est déjà dans la banque.", 409, "duplicate", { paperId: known.paper_id });

  // 2-3. The text and the questions.
  const extraction = await extractExam(input, bytes);
  const { exam } = extraction;
  if (!exam.stats.looksLikeExam) {
    throw new GenomeIngestError("Ce document ne ressemble pas à un sujet d'examen (moins de 5 questions à choix lisibles).", 422, "not_an_exam", { stats: exam.stats });
  }

  // 4. The scope, from the paper's own header.
  const header = exam.header || extraction.text.slice(0, 1500);
  const scope = detectPaperScope(header);
  if (scope.verdict === "out_of_scope") {
    throw new GenomeIngestError(
      `Hors périmètre : la banque ne contient que les sujets de Médecine de la Faculté de Médecine de Blida 1 (${scope.reasons.join(", ")}).`,
      422,
      "out_of_scope",
      { reasons: scope.reasons }
    );
  }

  // 5. The metadata.
  const { meta, warnings } = resolveMeta(input, scope, header);
  warnings.push(...exam.warnings);
  if (scope.verdict === "unverified") warnings.push("L'en-tête ne nomme ni Blida ni la filière : à confirmer par un relecteur.");

  // 6. Questions and duplicates.
  const drafts = exam.questions.map(toDraft);
  const storedAsUnreadable = drafts.filter((d) => d.unreadable).length;
  const incoming = drafts.map((d) => d.draft);
  const unitPapers = await loadUnitPapers(supabase, meta.unitCode, ["needs_review", "published"]);
  const existing = unitPapers.length ? await loadPaperQuestions(supabase, unitPapers.map((p) => p.id)) : [];
  const existingPrints = existing.map((q) => ({ id: q.id, paperId: q.paper_id, family: q.family_id ?? q.id, print: questionPrint(q) }));
  const familyOf = new Map(existingPrints.map((e) => [e.id, e.family]));
  const matches = matchQuestions(
    incoming.map((d) => d.print),
    existingPrints.map((e) => ({ id: e.id, print: e.print }))
  );
  const families = new Map(matches.map((m) => [m.index, familyOf.get(m.id) ?? m.id]));

  let duplicateOf: string | null = null;
  for (const paper of unitPapers) {
    const theirs = existingPrints.filter((e) => e.paperId === paper.id).map((e) => e.print);
    const overlap = paperOverlap(incoming.map((d) => d.print), theirs);
    if (overlap.ratio < SAME_PAPER_RATIO) continue;
    const sameSlot =
      paper.academic_year === meta.academicYear && paper.session === meta.session && paper.sitting === meta.sitting && (paper.rotation ?? null) === meta.rotation && (paper.variant ?? null) === meta.variant;
    if (sameSlot) {
      duplicateOf = paper.id;
      warnings.push(`Doublon : ${Math.round(overlap.ratio * 100)} % des questions sont celles d'un sujet déjà enregistré pour la même épreuve.`);
      break;
    }
    warnings.push(
      `${Math.round(overlap.ratio * 100)} % des questions sont identiques au sujet ${paper.academic_year} (${paper.session}, ${paper.sitting}) : vérifier l'année et la session déclarées.`
    );
  }

  // 7. The key the document carries.
  const source = keySourceFor(meta.provenance);
  const level = maxTrustForSource(source, meta.provenance);
  let keysFromDocument = 0;
  const questions = incoming.map((d, index) => {
    const answer = exam.answerGrid[d.position];
    const keys: { answer: string; level: number; source: KeySource; contributor_id: string }[] = [];
    if (answer && d.format !== "qroc") {
      if (isAnswerValidForFormat(answer, d.format, d.options.length)) {
        keys.push({ answer, level, source, contributor_id: userId });
        keysFromDocument += 1;
      } else warnings.push(`Question ${d.position} : réponse « ${answer} » incompatible avec une ${d.format.toUpperCase()} de ${d.options.length} options — ignorée.`);
    }
    const effective = resolveEffectiveKey(keys.map((k) => ({ answer: k.answer, level: k.level as 1 | 3 | 4, source: k.source, contributorId: userId })));
    return {
      position: d.position,
      format: d.format,
      polarity: d.polarity,
      context: d.context,
      stem: d.stem,
      propositions: d.propositions,
      options: d.options,
      norm_text: d.print.normText,
      content_hash: d.print.hash,
      family_id: families.get(index) ?? null,
      parse_confidence: d.parseConfidence,
      parse_issues: d.parseIssues,
      effective_answer: effective.answer,
      effective_level: effective.answer ? effective.level : 0,
      key_contested: effective.contested,
      keys,
    };
  });

  // 8. One transaction.
  const status = duplicateOf ? "duplicate" : "needs_review";
  const { data: paperId, error: rpcError } = await supabase.rpc("eg_ingest_paper", {
    p: {
      paper: {
        year_level: meta.yearLevel,
        unit_code: meta.unitCode,
        academic_year: meta.academicYear,
        session: meta.session,
        sitting: meta.sitting,
        rotation: meta.rotation,
        variant: meta.variant,
        exam_date: meta.examDate,
        duration_minutes: meta.durationMinutes,
        provenance: meta.provenance,
        status,
        duplicate_of: duplicateOf,
        scope_verdict: scope.verdict,
        legacy_programme: isLegacyProgramme(meta),
        parse_confidence: exam.stats.meanConfidence,
        parse_warnings: warnings.slice(0, 40).map((w) => w.slice(0, 300)),
        notes: input.declared.notes?.slice(0, 2000) ?? null,
        contributed_by: userId,
      },
      source: {
        storage_path: storagePath,
        sha256,
        mime_type: input.mimeType,
        byte_size: bytes.length,
        page_count: extraction.pages,
        extraction: extraction.method,
        extracted_chars: extraction.text.length,
        uploaded_by: userId,
      },
      questions,
    },
  });
  if (rpcError || typeof paperId !== "string") {
    if (rpcError) raiseDbError(rpcError, "enregistrement du sujet");
    throw new Error("[exam-genome] enregistrement du sujet : identifiant manquant");
  }

  return {
    paperId,
    status,
    duplicateOf,
    meta,
    scope: { verdict: scope.verdict, reasons: scope.reasons },
    extraction: extraction.method,
    stats: exam.stats,
    storedAsUnreadable,
    keysFromDocument,
    keyLevel: keysFromDocument ? level : null,
    recurringQuestions: families.size,
    warnings,
  };
}

/** Best-effort trace of what a contributor sent and what became of it (eg_contributions). */
export async function recordContribution(
  supabase: Admin,
  entry: { contributorId: string; isAdmin: boolean; declared: DeclaredMeta; paperId?: string | null; outcome: ContributionOutcome; detail?: string | null }
): Promise<void> {
  const unit = entry.declared.unitCode ? getBlidaUnit(entry.declared.unitCode) : undefined;
  const { error } = await supabase.from("eg_contributions").insert({
    contributor_id: entry.contributorId,
    role: entry.isAdmin ? "admin" : "student",
    declared_unit_code: unit?.code ?? null,
    declared_academic_year: entry.declared.academicYear ?? null,
    declared_session: entry.declared.session ?? null,
    declared_sitting: entry.declared.sitting ?? null,
    paper_id: entry.paperId ?? null,
    outcome: entry.outcome,
    detail: entry.detail?.slice(0, 2000) ?? null,
  });
  if (error) console.warn("[exam-genome] Contribution non tracée (non bloquant) :", error.message);
}
