import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getUserCourse, getUserCourseSourceText } from "@/lib/user-courses";
import {
  getCachedContent,
  setCachedContent,
  setCachedContentBatch,
} from "@/lib/course-content-cache";
import {
  CourseGenerationError,
  generateCourseContent,
  generateCoursOral,
} from "@/lib/ai/generate-course-content";
import { canGenerate, recordGeneration } from "@/lib/subscription";
import { profileFromUser } from "@/lib/auth";
import type { ContentType } from "@/lib/types";

export const runtime = "nodejs";

const SECTION_TYPES: ContentType[] = [
  "explication",
  "resume",
  "pieges",
  "astuces",
  "cas_clinique",
  "qcm",
];

function isContentType(value: unknown): value is ContentType {
  return value === "cours_oral" || SECTION_TYPES.includes(value as ContentType);
}

/**
 * The heart of the on-demand model: check course_content_cache for
 * (courseId, contentType) first (0 tokens on a hit); on a miss, gate behind
 * the subscription/trial check, call OpenRouter, cache the result, return it.
 *
 * For the 6 Studio sections, one AI call fills all 6 cache slots at once
 * (the mega-prompt already produces them together) — so clicking a second
 * Studio button for the same course is a free cache hit even though it was
 * never requested directly before.
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

  if (!isContentType(contentType)) {
    return NextResponse.json({ error: "Type de contenu invalide." }, { status: 400 });
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
    if (contentType === "cours_oral") {
      const content = await generateCoursOral(sourceText);
      await setCachedContent(course.id, "cours_oral", content);
      await recordGeneration(user.id);
      return NextResponse.json({ content, cached: false });
    }

    // Any of the 6 Studio sections: one call fills all of them.
    const student = profileFromUser(user);
    const sixSections = await generateCourseContent(sourceText, student);

    await setCachedContentBatch(course.id, {
      explication: sixSections.explication,
      resume: sixSections.resume,
      pieges: sixSections.pieges,
      astuces: sixSections.astuces,
      cas_clinique: sixSections.casClinique,
      qcm: sixSections.qcm,
    });
    await recordGeneration(user.id);

    const contentByType: Record<Exclude<ContentType, "cours_oral">, string> = {
      explication: sixSections.explication,
      resume: sixSections.resume,
      pieges: sixSections.pieges,
      astuces: sixSections.astuces,
      cas_clinique: sixSections.casClinique,
      qcm: sixSections.qcm,
    };

    return NextResponse.json({ content: contentByType[contentType], cached: false });
  } catch (error) {
    if (error instanceof CourseGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unexpected on-demand generation error", error);
    return NextResponse.json({ error: "Une erreur inattendue est survenue." }, { status: 500 });
  }
}
