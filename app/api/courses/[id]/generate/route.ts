import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getUserCourse, getUserCourseSourceText } from "@/lib/user-courses";
import { getCachedContent, setCachedContent } from "@/lib/course-content-cache";
import {
  CourseGenerationError,
  generateCoursOral,
  generateExplicationUltraDetaillee,
  generateModeVisuel,
  generateResumeMasterclass,
} from "@/lib/ai/generate-course-content";
import { canGenerate, recordGeneration } from "@/lib/subscription";
import { profileFromUser } from "@/lib/auth";
import type { SingleUnitContentType } from "@/lib/types";

export const runtime = "nodejs";

const SINGLE_UNIT_TYPES: SingleUnitContentType[] = [
  "cours_oral",
  "explication",
  "mode_visuel",
  "resume",
];

function isSingleUnitContentType(value: unknown): value is SingleUnitContentType {
  return SINGLE_UNIT_TYPES.includes(value as SingleUnitContentType);
}

/**
 * Handles the 4 single-unit content types — each filled by exactly one
 * dedicated AI call (see lib/ai/generate-course-content.ts). "cas_clinique"
 * and "qcm" are NOT handled here anymore: they're chunked into several
 * sub-units generated concurrently by the streaming route, see
 * app/api/courses/[id]/generate-stream/route.ts.
 *
 * Same on-demand model as before: check course_content_cache first (0
 * tokens on a hit); on a miss, gate behind the subscription/trial check,
 * call OpenRouter, cache the result, return it.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const course = await getUserCourse(params.id, user.id);
  if (!course) {
    return NextResponse.json({ error: "Cours introuvable." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const contentType = body?.contentType;
  const force = body?.force === true;

  if (!isSingleUnitContentType(contentType)) {
    return NextResponse.json(
      {
        error:
          "Type de contenu invalide pour cette route. « cas_clinique » et « qcm » utilisent /generate-stream.",
      },
      { status: 400 }
    );
  }

  if (!force) {
    const cached = await getCachedContent(course.id, contentType);
    if (cached) {
      return NextResponse.json({ content: cached, cached: true });
    }
  }

  const gate = await canGenerate(user);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 402 });
  }

  const sourceText = await getUserCourseSourceText(course.id, user.id);
  if (!sourceText) {
    return NextResponse.json(
      { error: "Le texte source de ce cours est introuvable." },
      { status: 404 }
    );
  }

  try {
    let content: string;

    if (contentType === "cours_oral") {
      content = await generateCoursOral(sourceText);
    } else if (contentType === "explication") {
      content = await generateExplicationUltraDetaillee(sourceText);
    } else if (contentType === "mode_visuel") {
      content = await generateModeVisuel(sourceText);
    } else {
      const student = profileFromUser(user);
      content = await generateResumeMasterclass(sourceText, student);
    }

    await setCachedContent(course.id, contentType, content);
    await recordGeneration(user.id);

    return NextResponse.json({ content, cached: false });
  } catch (error) {
    if (error instanceof CourseGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unexpected on-demand generation error", error);
    return NextResponse.json({ error: "Une erreur inattendue est survenue." }, { status: 500 });
  }
}
