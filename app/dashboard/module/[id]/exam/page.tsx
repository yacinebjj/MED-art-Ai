"use client";

/**
 * Custom Exam Generator Workspace — fully mocked (no backend, no real
 * question generation) per spec. Course list, generation delay, exam
 * questions and scoring are all local state; wiring this to a real
 * generation pipeline (à la lib/course-generation-shared.ts's
 * generateCourseSection) would be a separate, much larger feature.
 *
 * Layout mirrors the exact responsive fix already applied to the two other
 * workspace pages (app/dashboard/demo/[slug]/page.tsx and
 * app/dashboard/module/[id]/page.tsx): flex-col + full-width h-[70vh] panels
 * on mobile, md:flex-row + fixed-width panels with internal scroll on
 * desktop.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileQuestion,
  ListChecks,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";

type ExamState = "idle" | "generating" | "testing" | "results";

interface MockCourse {
  id: string;
  title: string;
}

const MOCK_COURSES: MockCourse[] = [
  { id: "c1", title: "Gastrite Aiguë et Chronique" },
  { id: "c2", title: "Appendicite Aiguë" },
  { id: "c3", title: "Pleurésie et Épanchements Pleuraux" },
  { id: "c4", title: "Insuffisance Rénale Aiguë" },
  { id: "c5", title: "Méningite Bactérienne du Nourrisson" },
];

interface ExamOption {
  label: string;
  text: string;
  isCorrect: boolean;
  explanation: string;
}

interface ExamQuestion {
  id: string;
  vignette: string;
  options: ExamOption[];
  weakPointTag: string;
}

// 3 clinical-vignette QCMs in the style typical of Algerian faculty exams
// (Saad Dahlab, Blida) — real physiopathological reasoning required, not
// simple recall: a surgical emergency (appendicitis), a classic diagnostic
// trap (Light's criteria for pleural effusion), and a pediatric emergency
// (bacterial meningitis management).
const MOCK_EXAM_QUESTIONS: ExamQuestion[] = [
  {
    id: "q1",
    vignette:
      "Un patient de 22 ans se présente aux urgences pour une douleur abdominale évoluant depuis 18 heures. Il rapporte une douleur initialement péri-ombilicale, migrant secondairement vers la fosse iliaque droite, associée à une anorexie et un épisode de vomissement. L'examen retrouve une défense en fosse iliaque droite, une température à 38,2°C et un signe de Blumberg positif. La NFS montre une hyperleucocytose à 14 000/mm³ à prédominance neutrophile. Quel est le diagnostic le plus probable ?",
    weakPointTag: "Sémiologie de l'abdomen aigu chirurgical",
    options: [
      {
        label: "A",
        text: "Colique néphrétique droite",
        isCorrect: false,
        explanation: "Une colique néphrétique donne une douleur lombaire irradiant vers les organes génitaux externes, sans défense pariétale ni migration péri-ombilicale caractéristique — le tableau ne colle pas.",
      },
      {
        label: "B",
        text: "Appendicite aiguë",
        isCorrect: true,
        explanation: "La triade migration péri-ombilicale → fosse iliaque droite, défense localisée, fièvre modérée et hyperleucocytose à neutrophiles est le tableau clinique classique de l'appendicite aiguë — le signe de Blumberg confirme l'irritation péritonéale localisée.",
      },
      {
        label: "C",
        text: "Salpingite aiguë",
        isCorrect: false,
        explanation: "À évoquer chez la femme jeune avec douleur pelvienne bilatérale et leucorrhées — sans objet ici chez un patient de sexe masculin.",
      },
      {
        label: "D",
        text: "Diverticulite sigmoïdienne",
        isCorrect: false,
        explanation: "Tableau clinique similaire mais localisé en fosse iliaque GAUCHE et plus fréquent après 50 ans — l'âge et la latéralité ne correspondent pas.",
      },
      {
        label: "E",
        text: "Gastro-entérite aiguë",
        isCorrect: false,
        explanation: "Donnerait des douleurs diffuses avec diarrhée au premier plan, sans défense localisée ni signe de Blumberg — la défense pariétale localisée élimine ce diagnostic.",
      },
    ],
  },
  {
    id: "q2",
    vignette:
      "Une femme de 45 ans, connue tuberculeuse traitée il y a 10 ans, consulte pour une douleur thoracique basi-thoracique droite augmentée à l'inspiration profonde, associée à une dyspnée d'effort progressive. L'examen retrouve une matité à la percussion de la base droite, une abolition du murmure vésiculaire et des vibrations vocales diminuées du même côté. La radiographie thoracique confirme un épanchement pleural droit de moyenne abondance. La ponction pleurale ramène un liquide citrin, avec un rapport protides pleural/sérique à 0,6 et un rapport LDH pleural/sérique à 0,7. Selon les critères de Light, comment qualifiez-vous cet épanchement ?",
    weakPointTag: "Critères de Light — Transudat vs Exsudat",
    options: [
      {
        label: "A",
        text: "Transudat, d'origine cardiaque probable",
        isCorrect: false,
        explanation: "Un transudat exige que les DEUX rapports (protides et LDH) restent sous le seuil — ici les deux dépassent le seuil, ce n'est donc pas un transudat, quelle que soit la cause suspectée.",
      },
      {
        label: "B",
        text: "Exsudat, nécessitant une enquête étiologique approfondie",
        isCorrect: true,
        explanation: "Les critères de Light qualifient un épanchement d'exsudat dès qu'UN SEUL des trois critères est positif : ici le rapport protides (0,6 > 0,5) ET le rapport LDH (0,7 > 0,6) sont tous les deux au-dessus du seuil — c'est un exsudat, qui impose de chercher une cause locale (infectieuse, tumorale, ou ici une possible réactivation tuberculeuse pleurale).",
      },
      {
        label: "C",
        text: "Hémothorax, d'origine traumatique",
        isCorrect: false,
        explanation: "Le liquide est décrit comme citrin (clair), pas sanglant, et aucun contexte traumatique n'est mentionné — à éliminer sur la description macroscopique seule.",
      },
      {
        label: "D",
        text: "Chylothorax, sur obstruction lymphatique",
        isCorrect: false,
        explanation: "Un chylothorax donne un liquide lactescent (blanchâtre), riche en triglycérides — incompatible avec un liquide citrin.",
      },
      {
        label: "E",
        text: "Transudat, dans le cadre d'un syndrome néphrotique",
        isCorrect: false,
        explanation: "Même raisonnement que l'option A : les deux rapports dépassent leur seuil respectif, ce qui exclut formellement un transudat, indépendamment de la cause évoquée.",
      },
    ],
  },
  {
    id: "q3",
    vignette:
      "Un nourrisson de 8 mois est amené aux urgences pour une fièvre à 39,5°C évoluant depuis 24 heures, associée à une somnolence inhabituelle et un refus de s'alimenter. L'examen retrouve un bombement de la fontanelle antérieure, une hypotonie axiale et des mouvements anormaux évoquant des convulsions. Aucune raideur de nuque n'est retrouvée (physiologiquement peu fiable à cet âge). Quelle est la conduite à tenir immédiate la plus appropriée ?",
    weakPointTag: "Urgence pédiatrique — méningite bactérienne",
    options: [
      {
        label: "A",
        text: "Antipyrétiques et surveillance à domicile",
        isCorrect: false,
        explanation: "Le bombement de la fontanelle, l'hypotonie et les convulsions sont des signes de gravité neurologique — un retour à domicile expose à un risque vital immédiat.",
      },
      {
        label: "B",
        text: "Ponction lombaire en urgence après stabilisation, puis antibiothérapie probabiliste sans délai",
        isCorrect: true,
        explanation: "Devant un tableau évocateur de méningite bactérienne chez le nourrisson, la ponction lombaire doit être réalisée en urgence dès que l'état hémodynamique le permet, et l'antibiothérapie probabiliste ne doit JAMAIS être retardée par l'attente des résultats — le pronostic vital et neurologique dépend directement de la rapidité de la prise en charge.",
      },
      {
        label: "C",
        text: "Scanner cérébral systématique avant toute ponction lombaire",
        isCorrect: false,
        explanation: "L'imagerie cérébrale préalable n'est indiquée qu'en présence de signes de localisation neurologique focale, de trouble de conscience sévère ou de suspicion d'hypertension intracrânienne majeure — la systématiser retarderait dangereusement la ponction lombaire et l'antibiothérapie.",
      },
      {
        label: "D",
        text: "Antibiothérapie orale ambulatoire et réévaluation à 48 heures",
        isCorrect: false,
        explanation: "Une suspicion de méningite bactérienne chez le nourrisson impose une hospitalisation et une antibiothérapie IV immédiate — la voie orale ambulatoire est totalement inadaptée à l'urgence du tableau.",
      },
      {
        label: "E",
        text: "Ponction lombaire différée après un traitement antibiotique de 48 heures",
        isCorrect: false,
        explanation: "Différer la ponction lombaire après le début de l'antibiothérapie risque de stériliser le LCR et de compromettre l'identification du germe — la ponction doit précéder ou accompagner immédiatement la première dose d'antibiotique, jamais être différée de 48 heures.",
      },
    ],
  },
];

const MAX_ATTEMPTS = 5;
const GENERATION_DELAY_MS = 2400;

const panelShellClasses =
  "flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition-all duration-300 dark:border-neutral-800 dark:bg-neutral-900";

export default function ExamGeneratorPage() {
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [examState, setExamState] = useState<ExamState>("idle");
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [attempts, setAttempts] = useState(MAX_ATTEMPTS);

  const allSelected = selectedCourseIds.size === MOCK_COURSES.length;
  const someSelected = selectedCourseIds.size > 0 && !allSelected;

  function toggleAll() {
    setSelectedCourseIds(allSelected ? new Set() : new Set(MOCK_COURSES.map((c) => c.id)));
  }

  function toggleCourse(id: string) {
    setSelectedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleGenerate() {
    if (selectedCourseIds.size === 0) return;
    setAnswers({});
    setExamState("generating");
  }

  function handleRegenerate() {
    if (attempts <= 0) return;
    setAttempts((a) => a - 1);
    setAnswers({});
    setExamState("generating");
  }

  function handleSelectAnswer(questionId: string, optionLabel: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionLabel }));
  }

  // Mocked generation delay — transitions generating -> testing on its own,
  // cleaned up if the component unmounts (or state changes again) mid-delay.
  useEffect(() => {
    if (examState !== "generating") return;
    const timer = setTimeout(() => setExamState("testing"), GENERATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [examState]);

  const answeredCount = useMemo(() => Object.values(answers).filter(Boolean).length, [answers]);

  const score = useMemo(
    () =>
      MOCK_EXAM_QUESTIONS.filter((q) => {
        const correct = q.options.find((o) => o.isCorrect);
        return correct && answers[q.id] === correct.label;
      }).length,
    [answers]
  );

  const weakPoints = useMemo(() => {
    const tags = MOCK_EXAM_QUESTIONS.filter((q) => {
      const correct = q.options.find((o) => o.isCorrect);
      return !correct || answers[q.id] !== correct.label;
    }).map((q) => q.weakPointTag);
    return Array.from(new Set(tags));
  }, [answers]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-100 dark:bg-neutral-950">
      <WorkspaceTopbar title="Générateur d'Examen" />

      {/* Same responsive pattern as the other two workspace pages: flex-col
          + full-width h-[70vh] panels on mobile, md:flex-row + fixed-width
          panels with internal scroll on desktop. */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row md:overflow-hidden">
        {/* Panneau Gauche — Sources */}
        <aside className={cn(panelShellClasses, "h-[70vh] w-full shrink-0 md:h-auto md:w-80")}>
          <div className="border-b border-gray-200 p-4 dark:border-neutral-800">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Cours du module</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {selectedCourseIds.size} / {MOCK_COURSES.length} sélectionné{selectedCourseIds.size > 1 ? "s" : ""}
            </p>
            <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
              />
              Sélectionner tout
            </label>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {MOCK_COURSES.map((course) => (
              <label
                key={course.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-neutral-800"
              >
                <Checkbox checked={selectedCourseIds.has(course.id)} onCheckedChange={() => toggleCourse(course.id)} />
                {course.title}
              </label>
            ))}
          </div>
        </aside>

        {/* Panneau Droit — Exam Arena */}
        <main className={cn(panelShellClasses, "h-[70vh] w-full flex-1 md:h-auto")}>
          {examState === "idle" && (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 dark:bg-primary-950/40">
                <FileQuestion className="h-8 w-8 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Prêt à te tester ?</h3>
                <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                  Sélectionne les cours à couvrir dans le panneau de gauche, puis génère un examen clinique complet.
                </p>
              </div>
              <Button size="lg" disabled={selectedCourseIds.size === 0} onClick={handleGenerate}>
                Générer l&apos;examen (40-60 QCM)
              </Button>
              {selectedCourseIds.size === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500">Sélectionne au moins un cours pour continuer.</p>
              )}
            </div>
          )}

          {examState === "generating" && (
            <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-30" />
                <Sparkles className="relative h-7 w-7 text-primary-600 dark:text-primary-400" />
              </div>
              <p className="max-w-sm text-center text-sm font-semibold text-gray-700 dark:text-gray-200">
                Création d&apos;un examen clinique type Faculté de Médecine Saad Dahlab (Blida)...
              </p>
              <div className="w-full max-w-md space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2 rounded-xl border border-gray-200 p-4 dark:border-neutral-800">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-neutral-700" />
                    <div className="h-3 w-full animate-pulse rounded bg-gray-200 dark:bg-neutral-700" />
                    <div className="h-3 w-5/6 animate-pulse rounded bg-gray-200 dark:bg-neutral-700" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {examState === "testing" && (
            <div className="flex h-full flex-col overflow-y-auto p-6 pb-28">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Épreuve Clinique</h2>
                <Badge variant="outline">
                  {answeredCount} / {MOCK_EXAM_QUESTIONS.length} répondues
                </Badge>
              </div>
              <div className="space-y-6">
                {MOCK_EXAM_QUESTIONS.map((q, index) => (
                  <div key={q.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                    <p className="mb-4 text-sm font-medium leading-relaxed text-gray-800 dark:text-gray-100">
                      <span className="mr-2 font-bold text-primary-600 dark:text-primary-400">Q{index + 1}.</span>
                      {q.vignette}
                    </p>
                    <div className="space-y-2" role="radiogroup" aria-label={`Options question ${index + 1}`}>
                      {q.options.map((opt) => {
                        const selected = answers[q.id] === opt.label;
                        return (
                          <label
                            key={opt.label}
                            className={cn(
                              "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors",
                              selected
                                ? "border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-950/30"
                                : "border-gray-200 hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                            )}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              className="sr-only"
                              checked={selected}
                              onChange={() => handleSelectAnswer(q.id, opt.label)}
                            />
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-bold text-gray-500 dark:text-gray-400">
                              {opt.label}
                            </span>
                            <span className="text-gray-700 dark:text-gray-200">{opt.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {examState === "results" && (
            <div className="flex h-full flex-col overflow-y-auto p-6">
              <div className="mb-6 rounded-2xl border-2 border-primary-200 bg-primary-50 p-5 text-center dark:border-primary-900/50 dark:bg-primary-950/20">
                <p className="text-xs font-bold uppercase tracking-wide text-primary-700 dark:text-primary-400">Score final</p>
                <p className="mt-1 text-4xl font-black text-gray-900 dark:text-white">
                  {score} / {MOCK_EXAM_QUESTIONS.length}
                </p>
              </div>

              <div className="space-y-6">
                {MOCK_EXAM_QUESTIONS.map((q, index) => {
                  const userAnswer = answers[q.id];
                  const correctOption = q.options.find((o) => o.isCorrect);
                  const isCorrect = !!correctOption && userAnswer === correctOption.label;
                  return (
                    <div key={q.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <p className="text-sm font-medium leading-relaxed text-gray-800 dark:text-gray-100">
                          <span className="mr-2 font-bold text-primary-600 dark:text-primary-400">Q{index + 1}.</span>
                          {q.vignette}
                        </p>
                        {isCorrect ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                        ) : (
                          <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                        )}
                      </div>

                      <div className="space-y-2">
                        {q.options.map((opt) => {
                          const isUserChoice = userAnswer === opt.label;
                          return (
                            <div
                              key={opt.label}
                              className={cn(
                                "flex items-start gap-3 rounded-xl border p-3 text-sm",
                                isUserChoice && opt.isCorrect && "border-emerald-500 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/30",
                                isUserChoice && !opt.isCorrect && "border-rose-500 bg-rose-50 dark:border-rose-600 dark:bg-rose-950/30",
                                !isUserChoice && opt.isCorrect && "border-dashed border-emerald-400 bg-white dark:bg-neutral-900",
                                !isUserChoice && !opt.isCorrect && "border-gray-200 dark:border-neutral-800"
                              )}
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-bold text-gray-500 dark:text-gray-400">
                                {opt.label}
                              </span>
                              <span className="flex-1 text-gray-700 dark:text-gray-200">{opt.text}</span>
                              {isUserChoice && opt.isCorrect && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                              {isUserChoice && !opt.isCorrect && <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
                              {!isUserChoice && opt.isCorrect && (
                                <Badge variant="outline" className="shrink-0 text-[10px]">
                                  Bonne réponse
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                          <Sparkles className="h-3.5 w-3.5" /> Explication détaillée
                        </p>
                        <ul className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
                          {q.options.map((opt) => (
                            <li key={opt.label}>
                              <span className="font-semibold">{opt.label}.</span> {opt.explanation}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>

              {weakPoints.length > 0 && (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <p className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4" /> Points Faibles Identifiés
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
                    {weakPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6">
                <Button variant="outline" className="w-full" onClick={handleRegenerate} disabled={attempts <= 0}>
                  <RotateCcw className="h-4 w-4" />
                  {attempts > 0
                    ? `Regénérer un examen (${attempts} tentative${attempts > 1 ? "s" : ""} restante${attempts > 1 ? "s" : ""})`
                    : "Aucune tentative restante"}
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      {examState === "testing" && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-gray-200 bg-white/95 p-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
          <p className="hidden text-sm text-gray-500 dark:text-gray-400 sm:block">
            <ListChecks className="mr-1.5 inline h-4 w-4" />
            {answeredCount} / {MOCK_EXAM_QUESTIONS.length} questions répondues
          </p>
          <Button className="w-full sm:w-auto" onClick={() => setExamState("results")}>
            Afficher la correction
          </Button>
        </div>
      )}
    </div>
  );
}
