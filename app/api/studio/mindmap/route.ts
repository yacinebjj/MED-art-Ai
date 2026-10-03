import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import { callOpenRouterResilient } from "@/lib/ai/call-resilient";
import { labContentHash, lookupLabCache, recordLabHistory, storeLabCache } from "@/lib/lab-course-cache";
import { errorMessage, parseJsonResponse, upstreamStatusForClient } from "@/lib/course-generation-shared";
import { refundGeneration, reserveGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
// 120 (was 60): the model call below may now run up to 90s, with headroom for
// one fast transient retry and the cache write.
export const maxDuration = 120;

type MindMapNodeKind = "etiologie" | "physiopathologie" | "clinique" | "diagnostic" | "traitement" | "complication" | "autre";

interface MindMapNode {
  label: string;
  kind: MindMapNodeKind;
  detail?: string;
  children?: MindMapNode[];
}

/** Same bound as the matrix route — a full course fits, and the call stays well inside its 50s budget. */
const MAX_SOURCE_CHARS_FOR_MINDMAP = 16_000;
/** Hard structural limits, enforced after validation by truncation (the prompt asks for less, this is the guarantee). */
const MAX_TOTAL_NODES = 70; // root included
const MAX_DEPTH = 3; // levels below the root
const MAX_BRANCHES = 8;
const MIN_BRANCHES = 2;
const MAX_LABEL_CHARS = 60;
const MAX_DETAIL_CHARS = 220;
const MAX_TITLE_CHARS = 120;

const MINDMAP_SYSTEM_PROMPT = `Tu es un médecin enseignant en faculté de médecine en Algérie. Tu transformes le cours fourni en CARTE MENTALE de révision : hiérarchique, synthétique, exacte, pensée pour mémoriser et réviser vite avant un examen.

Réponds UNIQUEMENT avec ce JSON — aucun texte autour, aucun markdown, aucun bloc de code :
{"title": "...", "root": {"label": "...", "children": [{"label": "...", "kind": "...", "detail": "...", "children": [{"label": "...", "kind": "..."}]}]}}

Structure :
1. "root.label" : le sujet central du cours, 60 caractères maximum.
2. 4 à 8 branches de premier niveau. Quand le cours s'y prête, organise-les selon les axes cliniques : étiologie, physiopathologie, clinique, diagnostic, traitement, complications. Sinon (cours fondamental), suis les grandes parties du cours avec "kind": "autre".
3. Profondeur maximale : 3 niveaux sous la racine. Entre 30 et 60 nœuds au total, jamais plus de 70.
4. "kind" vaut EXACTEMENT l'une de ces valeurs, sans accent : "etiologie", "physiopathologie", "clinique", "diagnostic", "traitement", "complication", "autre". Un nœud enfant reprend normalement le "kind" de sa branche.
5. "label" : un mot-clé ou une expression courte (60 caractères maximum), jamais une phrase entière.
6. "detail" (facultatif) : une phrase de 200 caractères maximum qui apporte la précision utile à l'examen (critère, chiffre, mécanisme, molécule). Omets-le quand le label se suffit à lui-même.
7. Omets "children" pour une feuille.

Exactitude :
- Chaque nœud vient du cours ou, à défaut, de la connaissance médicale standard, vérifiée et consensuelle. N'invente jamais un chiffre, une dose, un seuil, un signe ou un nom absent de ces sources.
- Mieux vaut un nœud de moins qu'un nœud faux.
- Tout en français.`;

interface StudioCourseRow {
  id: number;
  title: string;
  raw_text: string | null;
  explication: string | null;
}

interface RawNode {
  label: string;
  kind?: string | null;
  detail?: string | null;
  children?: RawNode[] | null;
}

const RawNodeSchema: z.ZodType<RawNode> = z.lazy(() =>
  z.object({
    label: z.string(),
    kind: z.string().nullish(),
    detail: z.string().nullish(),
    children: z.array(RawNodeSchema).nullish(),
  })
);

const MindMapAiSchema = z.object({
  title: z.string().nullish(),
  root: z.object({
    label: z.string(),
    children: z.array(RawNodeSchema).min(1),
  }),
});

function cleanText(value: string | null | undefined, maxChars: number): string {
  if (!value) return "";
  const text = value
    .replace(/\*\*|__|`/g, "")
    // Leading list/heading markers only — never "<" / ">", which are real content in medical labels ("> 50 ans").
    .replace(/^[\s\-–•*#]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  // Cut on a word boundary when one is reasonably close, so a label never ends mid-word.
  const hard = text.slice(0, maxChars - 1);
  const lastSpace = hard.lastIndexOf(" ");
  return `${(lastSpace > maxChars * 0.6 ? hard.slice(0, lastSpace) : hard).trimEnd()}…`;
}

/** Maps whatever the model wrote ("Étiologies", "Signes cliniques", "Prise en charge"...) onto the fixed kind enum. */
function normalizeKind(raw: string | null | undefined, fallback: MindMapNodeKind): MindMapNodeKind {
  if (!raw) return fallback;
  const key = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (key.startsWith("etio") || key.startsWith("cause") || key.includes("facteur")) return "etiologie";
  if (key.startsWith("physio") || key.includes("mecanisme")) return "physiopathologie";
  if (key.startsWith("clin") || key.includes("signe") || key.includes("symptom") || key.includes("semiolog")) return "clinique";
  if (key.startsWith("diag") || key.includes("examen") || key.includes("bilan") || key.includes("paraclin")) return "diagnostic";
  if (key.startsWith("trait") || key.includes("therap") || key.includes("prise en charge") || key.includes("prevention")) return "traitement";
  if (key.startsWith("compli") || key.includes("evolution") || key.includes("pronostic")) return "complication";
  if (key.startsWith("autre")) return "autre";
  return fallback;
}

/**
 * Builds the final tree with every structural limit enforced. Children are
 * admitted level by level and round-robin across siblings (1st child of
 * every parent, then 2nd child of every parent...), so when the node budget
 * runs out it trims the deepest, least important nodes evenly instead of
 * starving the last branches entirely.
 */
function buildTree(rawChildren: RawNode[]): MindMapNode[] {
  const usableChildren = new Map<RawNode, RawNode[]>();
  const childrenOf = (raw: RawNode): RawNode[] => {
    let list = usableChildren.get(raw);
    if (!list) {
      list = (raw.children ?? []).filter((child) => cleanText(child.label, MAX_LABEL_CHARS).length > 0);
      usableChildren.set(raw, list);
    }
    return list;
  };

  const makeNode = (raw: RawNode, kind: MindMapNodeKind): MindMapNode => {
    const node: MindMapNode = { label: cleanText(raw.label, MAX_LABEL_CHARS), kind };
    const detail = cleanText(raw.detail, MAX_DETAIL_CHARS);
    if (detail && detail !== node.label) node.detail = detail;
    return node;
  };

  interface Pending {
    raw: RawNode;
    node: MindMapNode;
    depth: number;
  }

  let budget = MAX_TOTAL_NODES - 1;
  const branches: MindMapNode[] = [];
  let level: Pending[] = [];

  for (const raw of rawChildren.filter((child) => cleanText(child.label, MAX_LABEL_CHARS).length > 0).slice(0, MAX_BRANCHES)) {
    if (budget <= 0) break;
    const node = makeNode(raw, normalizeKind(raw.kind, "autre"));
    branches.push(node);
    level.push({ raw, node, depth: 1 });
    budget--;
  }

  while (level.length > 0 && budget > 0 && level[0].depth < MAX_DEPTH) {
    const next: Pending[] = [];
    const widest = Math.max(...level.map((pending) => childrenOf(pending.raw).length));
    for (let index = 0; index < widest && budget > 0; index++) {
      for (const pending of level) {
        if (budget <= 0) break;
        const rawChild = childrenOf(pending.raw)[index];
        if (!rawChild) continue;
        const child = makeNode(rawChild, normalizeKind(rawChild.kind, pending.node.kind));
        (pending.node.children ??= []).push(child);
        next.push({ raw: rawChild, node: child, depth: pending.depth + 1 });
        budget--;
      }
    }
    level = next;
  }

  return branches;
}

function countNodes(nodes: MindMapNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);
}

/** A cached row must still look like a renderable tree: a titled root with at least MIN_BRANCHES children, each node labelled. */
function isStoredMindMap(value: unknown): value is { title: string; root: { label: string; children: MindMapNode[] } } {
  if (!value || typeof value !== "object") return false;
  const v = value as { title?: unknown; root?: { label?: unknown; children?: unknown } };
  if (typeof v.title !== "string" || !v.root || typeof v.root.label !== "string" || !Array.isArray(v.root.children)) return false;
  const validNode = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const n = node as { label?: unknown; kind?: unknown; children?: unknown };
    if (typeof n.label !== "string" || typeof n.kind !== "string") return false;
    return n.children === undefined || (Array.isArray(n.children) && n.children.every(validNode));
  };
  return v.root.children.length >= MIN_BRANCHES && v.root.children.every(validNode);
}

function pickSourceText(course: StudioCourseRow): string {
  const explication = course.explication?.trim();
  const source = explication ? explication : (course.raw_text ?? "").trim();
  return source.slice(0, MAX_SOURCE_CHARS_FOR_MINDMAP);
}

/**
 * On-demand interactive "Carte mentale" for one course — a structured tree
 * the client lays out and renders itself (no image model, no Mermaid). One
 * real generation: reserves one unit of courseCap before the OpenRouter call
 * and refunds it on any failure after that point. Nothing is persisted
 * server-side; the client caches the map per student/course.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`studio-mindmap:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { courseId } = (body ?? {}) as { courseId?: unknown };
  if (typeof courseId !== "number" || !Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ success: false, error: "'courseId' est requis (entier positif)." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const { data: courseRow, error: courseError } = await getSupabaseAdmin()
    .from("studio_courses")
    .select("id, title, raw_text, explication")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (courseError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
  }
  if (!courseRow) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  const course = courseRow as StudioCourseRow;
  const sourceText = pickSourceText(course);
  if (!sourceText) {
    return NextResponse.json(
      { success: false, error: "Ce cours n'a pas encore de contenu exploitable pour construire une carte mentale." },
      { status: 422 }
    );
  }

  // Platform-wide cache FIRST (see lib/lab-course-cache.ts): a hit returns the
  // stored map for 0 tokens and 0 credits — before the quota gate.
  const contentHash = labContentHash(course.raw_text?.trim() ? course.raw_text : sourceText);
  const cached = await lookupLabCache(contentHash, "mindmap");
  if (isStoredMindMap(cached)) {
    await recordLabHistory({ userId: user.id, contentHash, toolType: "mindmap", courseId: course.id, title: cached.title });
    return NextResponse.json({ success: true, mindmap: cached, cached: true });
  }

  const gate = await reserveGeneration(user);
  if (!gate.allowed) {
    return NextResponse.json({ success: false, error: gate.reason }, { status: 403 });
  }

  try {
    const raw = await callOpenRouterResilient(
      [
        { role: "system", content: MINDMAP_SYSTEM_PROMPT },
        { role: "user", content: `Cours : "${course.title}"\n\nContenu du cours :\n"""\n${sourceText}\n"""` },
      ],
      // AbortController-backed timeout inside callOpenRouter; well under maxDuration so it fails cleanly (and refunds) before the platform kills the route.
      { model: CHEAP_MODEL, maxTokens: 5000, temperature: 0.2, timeoutMs: 90_000, bypassMock: true }
    );

    const parsed = parseJsonResponse(raw);
    const candidate = parsed.mindmap && typeof parsed.mindmap === "object" && !Array.isArray(parsed.mindmap) ? parsed.mindmap : parsed;
    const validation = MindMapAiSchema.safeParse(candidate);
    if (!validation.success) {
      console.error("[studio:mindmap] Validation zod échouée :", validation.error.flatten());
      throw new Error("La réponse de l'IA ne respecte pas le format attendu de la carte mentale. Réessaie.");
    }

    const children = buildTree(validation.data.root.children);
    if (children.length < MIN_BRANCHES) {
      throw new Error("La carte mentale générée est trop pauvre pour être utile. Réessaie.");
    }

    const rootLabel = cleanText(validation.data.root.label, MAX_LABEL_CHARS) || cleanText(course.title, MAX_LABEL_CHARS) || "Cours";
    const title = cleanText(validation.data.title, MAX_TITLE_CHARS) || cleanText(course.title, MAX_TITLE_CHARS) || rootLabel;

    console.log(`[studio:mindmap] Carte générée (cours ${course.id}) : ${children.length} branches, ${countNodes(children) + 1} nœuds.`);

    const mindmap = { title, root: { label: rootLabel, children } };
    await storeLabCache({ contentHash, toolType: "mindmap", courseId: course.id, content: mindmap });
    await recordLabHistory({ userId: user.id, contentHash, toolType: "mindmap", courseId: course.id, title: mindmap.title });

    return NextResponse.json({ success: true, mindmap, cached: false });
  } catch (error) {
    await refundGeneration(user.id);
    const status = error instanceof OpenRouterError ? upstreamStatusForClient(error.status) : 502;
    console.error(`[studio:mindmap] Échec (cours ${course.id}):`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
