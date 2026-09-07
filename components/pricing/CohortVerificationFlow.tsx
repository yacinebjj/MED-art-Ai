"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useLanguage } from "@/providers/LanguageProvider";

const FACULTIES = [
  { value: "medecine", label: { fr: "Médecine", en: "Medicine" } },
  { value: "pharmacie", label: { fr: "Pharmacie", en: "Pharmacy" } },
  { value: "dentaire", label: { fr: "Chirurgie Dentaire", en: "Dental Surgery" } },
];

type VerificationStatus = "idle" | "checking" | "verified";

interface CohortVerificationFlowProps {
  onVerifiedChange: (verified: boolean) => void;
}

/**
 * "Prouve que tu fais partie de la promo" mechanic for the Promo Cohorte
 * tier: Faculté + Code Délégué, a fast 2-field flow instead of a real
 * document-upload/admin-review process. No backend endpoint exists yet to
 * validate a real delegate code against a real cohort roster — this
 * DELIBERATELY accepts any non-empty faculty+code pair (a short simulated
 * "checking" delay, then success) as a front-end-only preview of the flow,
 * exactly like GroupInviteFlow's invite-link preview. Gates the tier's own
 * CTA via onVerifiedChange so the page can't let a viewer "buy" the cohort
 * price without at least going through the motion of proving eligibility.
 */
export function CohortVerificationFlow({ onVerifiedChange }: CohortVerificationFlowProps) {
  const { language } = useLanguage();
  const [faculty, setFaculty] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<VerificationStatus>("idle");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!faculty || !code.trim() || status === "checking") return;
    setStatus("checking");
    setTimeout(() => {
      setStatus("verified");
      onVerifiedChange(true);
    }, 700);
  }

  function handleReset() {
    setStatus("idle");
    onVerifiedChange(false);
  }

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {language === "fr" ? "Vérifie ton éligibilité" : "Verify your eligibility"}
      </p>

      {/* A single AnimatePresence mode="wait" straddling both the <form> and
          the success state used to get stuck here permanently: React's own
          hook state (verified via a direct fiber inspection while debugging)
          committed to "verified" correctly, but AnimatePresence's exit-wait
          for the outgoing <motion.form> never resolved, so the incoming
          success view never mounted — a real, reproducible failure mode of
          gating a functionally CRITICAL transition behind an exit-animation
          callback, not worth the cosmetic cross-fade. Each branch now just
          animates its own entrance independently (no shared AnimatePresence,
          no exit wait) — the outgoing element unmounts immediately, the
          incoming one still fades in via its own `initial`/`animate`. */}
      <AnimatePresence initial={false}>
        {status === "verified" && (
          <motion.div
            key="verified"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm dark:border-emerald-900/40 dark:bg-emerald-900/20"
          >
            <span className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {language === "fr"
                ? `Éligibilité confirmée — ${FACULTIES.find((f) => f.value === faculty)?.label[language]}`
                : `Eligibility confirmed — ${FACULTIES.find((f) => f.value === faculty)?.label[language]}`}
            </span>
            <button
              type="button"
              onClick={handleReset}
              className="shrink-0 text-xs font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900 dark:text-emerald-400"
            >
              {language === "fr" ? "Modifier" : "Edit"}
            </button>
          </motion.div>
        )}
        {status !== "verified" && (
          <motion.form
            key="form"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleSubmit}
            className="mt-3 space-y-2.5"
          >
            <div className="relative">
              <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                value={faculty}
                onChange={(e) => setFaculty(e.target.value)}
                required
                className="h-10 w-full appearance-none rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-primary-400"
              >
                <option value="" disabled>
                  {language === "fr" ? "Sélectionne ta faculté" : "Select your faculty"}
                </option>
                {FACULTIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label[language]}
                  </option>
                ))}
              </select>
            </div>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              placeholder={language === "fr" ? "Code Délégué (ex : MED-ALGER-2026)" : "Delegate code (e.g. MED-ALGER-2026)"}
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors focus:border-primary-400"
            />

            <Button type="submit" size="sm" variant="outline" className="w-full" disabled={status === "checking"}>
              {status === "checking" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {language === "fr" ? "Vérification..." : "Verifying..."}
                </>
              ) : language === "fr" ? (
                "Vérifier mon éligibilité"
              ) : (
                "Verify my eligibility"
              )}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
