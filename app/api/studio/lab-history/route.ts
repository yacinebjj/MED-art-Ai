import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { labContentHash, type LabToolType } from "@/lib/lab-course-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The only tool variants this endpoint knows how to return. */
const KNOWN_TOOL_TYPES: readonly LabToolType[] = [
  "matrix:pharmaco",
  "matrix:ddx",
  "mindmap",
  "case:externe",
  "case:interne",
  "case:concours",
];

interface HistoryRow {
  tool_type: string;
  title: string | null;
  last_opened_at: string;
}

interface CacheRow {
  tool_type: string;
  content: unknown;
}

export interface LabHistoryItem {
  toolType: LabToolType;
  title: string | null;
  lastOpenedAt: string;
  /** Matrix / mind-map: the full generated content. Always null for a case. */
  content: unknown | null;
  /** Patient virtuel only: what the student needs to recognise the case. The hidden answer key is NEVER included. */
  caseSummary: { title: string; patient: unknown; motif: string } | null;
}

function isKnownToolType(value: string): value is LabToolType {
  return (KNOWN_TOOL_TYPES as readonly string[]).includes(value);
}

/**
 * GET /api/studio/lab-history?courseId=<studio course id>
 *
 * What THIS student has already opened in the MedArt Lab for THIS course's
 * content: patient cases, pharmaco/DDx matrices, mind maps. Rows come from
 * user_lab_history (written on every generation and every cache hit — see
 * recordLabHistory), joined to lab_course_cache for the content. Scoped by
 * user id on the server (service-role client, explicit filter), and by the
 * course's content hash, so a re-uploaded copy of the same polycop finds the
 * same history. No AI call, no credit.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const courseId = Number(request.nextUrl.searchParams.get("courseId"));
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ success: false, error: "'courseId' est requis (entier positif)." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: courseRow, error: courseError } = await supabase
    .from("studio_courses")
    .select("raw_text")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<{ raw_text: string | null }>();
  if (courseError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${courseError.message}` }, { status: 500 });
  }
  if (!courseRow) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }
  const rawText = courseRow.raw_text?.trim() ?? "";
  if (!rawText) return NextResponse.json({ success: true, items: [] satisfies LabHistoryItem[] });

  const contentHash = labContentHash(rawText);

  const { data: historyRows, error: historyError } = await supabase
    .from("user_lab_history")
    .select("tool_type, title, last_opened_at")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .order("last_opened_at", { ascending: false })
    .returns<HistoryRow[]>();

  if (historyError) {
    // Table not created yet (migration pending) or a transient error: an empty history, never a broken tool.
    console.error("[studio/lab-history] Lecture impossible — historique vide renvoyé :", historyError.message);
    return NextResponse.json({ success: true, items: [] satisfies LabHistoryItem[] });
  }

  const known = (historyRows ?? []).filter((row) => isKnownToolType(row.tool_type));
  if (known.length === 0) return NextResponse.json({ success: true, items: [] satisfies LabHistoryItem[] });

  const { data: cacheRows, error: cacheError } = await supabase
    .from("lab_course_cache")
    .select("tool_type, content")
    .eq("content_hash", contentHash)
    .in("tool_type", known.map((row) => row.tool_type))
    .returns<CacheRow[]>();
  if (cacheError) {
    console.error("[studio/lab-history] Lecture du cache impossible — historique vide renvoyé :", cacheError.message);
    return NextResponse.json({ success: true, items: [] satisfies LabHistoryItem[] });
  }
  const contentByType = new Map((cacheRows ?? []).map((row) => [row.tool_type, row.content]));

  const items: LabHistoryItem[] = [];
  for (const row of known) {
    const content = contentByType.get(row.tool_type);
    if (content === undefined || content === null) continue; // pointer without content: nothing to show
    const toolType = row.tool_type as LabToolType;

    if (toolType.startsWith("case:")) {
      const publicCase = (content as { publicCase?: { title?: unknown; patient?: unknown; motif?: unknown } }).publicCase;
      if (!publicCase || typeof publicCase.title !== "string" || typeof publicCase.motif !== "string") continue;
      items.push({
        toolType,
        title: row.title,
        lastOpenedAt: row.last_opened_at,
        content: null,
        caseSummary: { title: publicCase.title, patient: publicCase.patient ?? null, motif: publicCase.motif },
      });
    } else {
      items.push({ toolType, title: row.title, lastOpenedAt: row.last_opened_at, content, caseSummary: null });
    }
  }

  return NextResponse.json({ success: true, items });
}
