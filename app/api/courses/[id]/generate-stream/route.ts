import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getUserCourse, getUserCourseSourceText } from "@/lib/user-courses";
import { getCachedSubUnits, setCachedContent } from "@/lib/course-content-cache";
import {
  CourseGenerationError,
  generateCasCliniqueUnit,
  generateQcmBatch,
  generateQroc,
} from "@/lib/ai/generate-course-content";
import { canGenerate, recordGeneration } from "@/lib/subscription";
import { profileFromUser } from "@/lib/auth";
import {
  CAS_CLINIQUE_CASES,
  QCM_BATCH_SIZE,
  QCM_BATCHES,
  QROC_COUNT,
  QROC_SUB_UNIT_ID,
} from "@/lib/sub-units";
import type { ChunkedContentType } from "@/lib/types";

export const runtime = "nodejs";

function isChunkedContentType(value: unknown): value is ChunkedContentType {
  return value === "cas_clinique" || value === "qcm";
}

/** One NDJSON line written to the stream as soon as its own sub-unit resolves. */
interface StreamLine {
  subUnitId: string;
  data: unknown;
  error: string | null;
}

/**
 * Fan-out generation for the two chunked content types ("cas_clinique": 5
 * cases, "qcm": 4 batches + 1 QROC set). Every sub-unit's cache-check +
 * generation runs concurrently via Promise.all — but instead of waiting for
 * all of them to resolve before responding, each one writes its own NDJSON
 * line to the response stream the moment IT resolves. The client (see
 * CasCliniqueLive.tsx / ExamQcmLive.tsx) reads the stream line-by-line and
 * renders each sub-unit as it arrives, with the still-pending ones showing
 * a skeleton — this is what turns "wait 3 minutes for everything" into
 * "see the first case in a few seconds, the rest fill in progressively".
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

  if (!isChunkedContentType(contentType)) {
    return NextResponse.json(
      { error: "Cette route ne gère que « cas_clinique » et « qcm »." },
      { status: 400 }
    );
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

  const student = profileFromUser(user);
  const alreadyCached = await getCachedSubUnits(course.id, contentType);

  // Rebind as plain non-null consts: TS narrowing from the early returns
  // above doesn't reliably persist into the nested closures below.
  const courseId = course.id;
  const text = sourceText;

  const encoder = new TextEncoder();
  let generatedAny = false;

  async function runCasCliniqueUnit(unit: (typeof CAS_CLINIQUE_CASES)[number]): Promise<StreamLine> {
    try {
      const cached = alreadyCached[unit.subUnitId];
      if (cached) {
        return { subUnitId: unit.subUnitId, data: JSON.parse(cached), error: null };
      }
      const data = await generateCasCliniqueUnit(text, student, unit.archetype, unit.numero);
      await setCachedContent(courseId, "cas_clinique", JSON.stringify(data), unit.subUnitId);
      generatedAny = true;
      return { subUnitId: unit.subUnitId, data, error: null };
    } catch (error) {
      const message =
        error instanceof CourseGenerationError ? error.message : "Une erreur inattendue est survenue.";
      return { subUnitId: unit.subUnitId, data: null, error: message };
    }
  }

  async function runQcmBatch(batch: (typeof QCM_BATCHES)[number]): Promise<StreamLine> {
    try {
      const cached = alreadyCached[batch.subUnitId];
      if (cached) {
        return { subUnitId: batch.subUnitId, data: JSON.parse(cached), error: null };
      }
      const data = await generateQcmBatch(text, batch.startIndex, QCM_BATCH_SIZE);
      await setCachedContent(courseId, "qcm", JSON.stringify(data), batch.subUnitId);
      generatedAny = true;
      return { subUnitId: batch.subUnitId, data, error: null };
    } catch (error) {
      const message =
        error instanceof CourseGenerationError ? error.message : "Une erreur inattendue est survenue.";
      return { subUnitId: batch.subUnitId, data: null, error: message };
    }
  }

  async function runQroc(): Promise<StreamLine> {
    try {
      const cached = alreadyCached[QROC_SUB_UNIT_ID];
      if (cached) {
        return { subUnitId: QROC_SUB_UNIT_ID, data: JSON.parse(cached), error: null };
      }
      const data = await generateQroc(text, QROC_COUNT);
      await setCachedContent(courseId, "qcm", JSON.stringify(data), QROC_SUB_UNIT_ID);
      generatedAny = true;
      return { subUnitId: QROC_SUB_UNIT_ID, data, error: null };
    } catch (error) {
      const message =
        error instanceof CourseGenerationError ? error.message : "Une erreur inattendue est survenue.";
      return { subUnitId: QROC_SUB_UNIT_ID, data: null, error: message };
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const jobs: Promise<StreamLine>[] =
        contentType === "cas_clinique"
          ? CAS_CLINIQUE_CASES.map((unit) => runCasCliniqueUnit(unit))
          : [...QCM_BATCHES.map((batch) => runQcmBatch(batch)), runQroc()];

      // Promise.all kicks off every sub-unit concurrently (parallel fan-out,
      // minimizing total wall-clock time to roughly one unit's duration
      // rather than the sum of all of them) — but each job writes its own
      // line to the stream the instant it settles, via .then() below, so the
      // client never waits for the slowest sibling to see the fastest result.
      await Promise.all(
        jobs.map((job) =>
          job.then((line) => {
            controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
          })
        )
      );

      if (generatedAny) {
        await recordGeneration(user.id);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
