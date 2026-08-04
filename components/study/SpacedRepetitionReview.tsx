"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BrainCircuit,
  Loader2,
  AlertTriangle,
  LogIn,
  PartyPopper,
  CheckCircle2,
  XCircle,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { CourseSlugSupabaseData } from "@/lib/course-slug-content";
import type { QcmItem, QrocItem } from "@/lib/types";

interface DueRow {
  course_slug: string;
  qcm_id: string;
  leitner_box: number;
  next_review_at: string;
}

type ReviewCard =
  | { kind: "qcm"; courseSlug: string; courseTitle: string; item: QcmItem }
  | { kind: "qroc"; courseSlug: string; courseTitle: string; item: QrocItem };

/** Reverses the "qcm-3" / "qroc-2" convention written by GastriteQcmsStudio.tsx's recordAttempt(). */
function parseQcmId(qcmId: string): { kind: "qcm" | "qroc"; id: number } | null {
  const match = qcmId.match(/^(qcm|qroc)-(\d+)$/);
  if (!match) return null;
  return { kind: match[1] as "qcm" | "qroc", id: Number(match[2]) };
}

async function fetchCourse(slug: string): Promise<CourseSlugSupabaseData | null> {
  try {
    const res = await fetch(`/api/courses/slug/${slug}`);
    if (!res.ok) return null;
    return (await res.json()) as CourseSlugSupabaseData;
  } catch {
    return null;
  }
}

/** Resolves the raw `/api/srs/due` rows (course_slug + qcm_id only) into full, renderable review cards by fetching each distinct course's stored QCM/QROC content and looking up the matching item. */
async function buildReviewQueue(due: DueRow[]): Promise<ReviewCard[]> {
  const uniqueSlugs = Array.from(new Set(due.map((row) => row.course_slug)));
  const courses = new Map<string, CourseSlugSupabaseData | null>();
  await Promise.all(
    uniqueSlugs.map(async (slug) => {
      courses.set(slug, await fetchCourse(slug));
    })
  );

  const cards: ReviewCard[] = [];
  for (const row of due) {
    const parsed = parseQcmId(row.qcm_id);
    const course = courses.get(row.course_slug);
    if (!parsed || !course?.qcms) continue;

    if (parsed.kind === "qcm") {
      const item = course.qcms.qcms.find((q) => q.id === parsed.id);
      if (item) cards.push({ kind: "qcm", courseSlug: row.course_slug, courseTitle: course.title, item });
    } else {
      const item = course.qcms.qrocs.find((q) => q.id === parsed.id);
      if (item) cards.push({ kind: "qroc", courseSlug: row.course_slug, courseTitle: course.title, item });
    }
  }
  return cards;
}

export function SpacedRepetitionReview() {
  const [status, setStatus] = useState<"loading" | "needs-auth" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      const res = await fetch("/api/srs/due").catch(() => null);
      if (!res) {
        if (!cancelled) {
          setStatus("error");
          setError("Impossible de contacter le serveur.");
        }
        return;
      }
      if (res.status === 401) {
        if (!cancelled) setStatus("needs-auth");
        return;
      }
      const body = await res.json().catch(() => ({}));
      const due: DueRow[] = Array.isArray(body?.due) ? body.due : [];
      const cards = await buildReviewQueue(due);
      if (cancelled) return;
      setQueue(cards);
      setIndex(0);
      setRevealed(false);
      setStatus("ready");
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGrade(isCorrect: boolean) {
    const current = queue[index];
    if (!current) return;
    setGrading(true);
    try {
      await fetch("/api/srs/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseSlug: current.courseSlug,
          qcmId: `${current.kind}-${current.item.id}`,
          isCorrect,
        }),
      });
    } finally {
      setGrading(false);
      setRevealed(false);
      setIndex((i) => i + 1);
    }
  }

  if (status === "loading") {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Recherche de tes révisions du jour...</span>
        </CardContent>
      </Card>
    );
  }

  if (status === "needs-auth") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <LogIn className="h-6 w-6" />
          <p className="text-sm">Connecte-toi pour voir tes révisions programmées.</p>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <p className="text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const current = queue[index];

  if (!current) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <PartyPopper className="h-8 w-8 text-emerald-500" />
          <p className="text-sm font-semibold text-foreground">
            {queue.length === 0 && index === 0 ? "Rien à réviser pour l'instant." : "Tout est traité pour aujourd'hui !"}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Réponds à des QCM dans tes cours (bouton « J&apos;ai réussi / J&apos;ai raté ») pour alimenter ta file de révision espacée.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <CardTitle>Révision Espacée</CardTitle>
          <p className="text-sm text-muted-foreground">{current.courseTitle}</p>
        </div>
        <Badge variant="outline">
          {index + 1}/{queue.length}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={(index / queue.length) * 100} />

        <AnimatePresence mode="wait">
          <motion.div
            key={`${current.courseSlug}-${current.kind}-${current.item.id}`}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <p className="text-sm font-semibold leading-relaxed text-foreground">{current.item.question}</p>

            {current.kind === "qcm" && (
              <div className="space-y-2">
                {current.item.options.map((opt) => {
                  const isCorrect = current.item.reponsesCorrectes.includes(opt.label);
                  return (
                    <div
                      key={opt.label}
                      className={cn(
                        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                        !revealed && "border-border bg-muted/40",
                        revealed && isCorrect && "border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
                        revealed && !isCorrect && "border-border bg-muted/20 text-muted-foreground"
                      )}
                    >
                      <span className="shrink-0 font-black">{opt.label}.</span>
                      <span className="flex-1">{opt.text}</span>
                      {revealed && isCorrect && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                      {revealed && !isCorrect && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />}
                    </div>
                  );
                })}
              </div>
            )}

            {current.kind === "qroc" && revealed && (
              <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 p-4">
                <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">Réponse attendue</p>
                <p className="text-sm font-medium text-foreground">{current.item.reponseOfficielle}</p>
              </div>
            )}

            {current.kind === "qcm" && revealed && (
              <div className="rounded-r-xl border-l-4 border-primary bg-primary-50 p-4 text-sm text-primary-900 dark:bg-primary-900/20 dark:text-primary-100">
                {current.item.explication.globale}
              </div>
            )}

            {!revealed ? (
              <Button onClick={() => setRevealed(true)} className="w-full sm:w-auto">
                Voir la réponse
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs text-muted-foreground">As-tu bien répondu ?</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={grading}
                  onClick={() => handleGrade(true)}
                  className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  J&apos;ai réussi
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={grading}
                  onClick={() => handleGrade(false)}
                  className="bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  J&apos;ai raté
                </Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
