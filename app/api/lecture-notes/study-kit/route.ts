import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { callOpenRouter, ECONOMY_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";
import { STUDY_KIT_SYSTEM_PROMPT } from "@/lib/ai/lecture-notes-prompts";
import type { LectureStudyKit } from "@/types/lecture-study-kit";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_NOTES_CHARS = 40_000;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[*_`#>]/g, "").trim().slice(0, max) : "";
}

/** Keeps only well-formed entries — a partially malformed model answer still yields a usable kit. */
function sanitizeKit(raw: unknown): LectureStudyKit {
  const obj = (raw ?? {}) as { flashcards?: unknown; highYield?: unknown; mindmap?: unknown };
  const flashcards = (Array.isArray(obj.flashcards) ? obj.flashcards : [])
    .map((c) => ({ front: str((c as { front?: unknown })?.front, 300), back: str((c as { back?: unknown })?.back, 600) }))
    .filter((c) => c.front && c.back)
    .slice(0, 24);
  const highYield = (Array.isArray(obj.highYield) ? obj.highYield : [])
    .map((h) => {
      const item = (h ?? {}) as { point?: unknown; why?: unknown; trap?: unknown };
      return { point: str(item.point, 300), why: str(item.why, 500), trap: str(item.trap, 300) };
    })
    .filter((h) => h.point)
    .slice(0, 14);
  const mm = (obj.mindmap ?? {}) as { center?: unknown; branches?: unknown };
  const branches = (Array.isArray(mm.branches) ? mm.branches : [])
    .map((b) => {
      const branch = (b ?? {}) as { label?: unknown; children?: unknown };
      return {
        label: str(branch.label, 80),
        children: (Array.isArray(branch.children) ? branch.children : []).map((c) => str(c, 90)).filter(Boolean).slice(0, 8),
      };
    })
    .filter((b) => b.label)
    .slice(0, 8);
  return { flashcards, highYield, mindmap: { center: str(mm.center, 80) || "Cours", branches } };
}

/**
 * On-demand revision kit for a Smart Notes result: flashcards, high-yield
 * exam points and a mind map, in one JSON call built strictly from the
 * notes. Ephemeral like app/api/lecture-notes/insights (cached on the
 * student's device, nothing persisted server-side): rate-limited, no quota.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`lecture-notes-kit:${user.id}`, RATE_LIMITS.ai);
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
  const { smartNotes } = (body ?? {}) as { smartNotes?: unknown };
  if (typeof smartNotes !== "string" || smartNotes.trim().length < 50) {
    return NextResponse.json({ success: false, error: "'smartNotes' est requis." }, { status: 400 });
  }

  try {
    const raw = await callOpenRouter(
      [
        { role: "system", content: STUDY_KIT_SYSTEM_PROMPT },
        { role: "user", content: smartNotes.slice(0, MAX_NOTES_CHARS) },
      ],
      { model: ECONOMY_MODEL, maxTokens: 6000, temperature: 0.2, reasoning: { effort: "low" }, timeoutMs: 100_000, providerSort: "throughput" }
    );
    const kit = sanitizeKit(parseJsonResponse(raw));
    if (kit.flashcards.length === 0 && kit.highYield.length === 0 && kit.mindmap.branches.length === 0) {
      throw new Error("Réponse IA inexploitable — réessaie.");
    }
    return NextResponse.json({ success: true, kit });
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : 502;
    console.error("[lecture-notes/study-kit] Échec:", errorMessage(error));
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
  }
}
