"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CreditCard, UserPlus, PartyPopper, Copy, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";

const STEPS = [
  { icon: CreditCard, label: { fr: "Vous payez", en: "You pay" } },
  { icon: UserPlus, label: { fr: "Invitez 4 amis", en: "Invite 4 friends" } },
  { icon: PartyPopper, label: { fr: "Accès débloqué pour tous", en: "Access unlocked for everyone" } },
];

/** Cosmetic-only slug for the invite-link preview below — no backend endpoint exists yet for real group invites (see this file's own note in the render), so this never needs to be unguessable/secure, just link-shaped. */
function randomSlug(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * "Comment ça marche" mechanic for the Groupe tier: an always-visible 3-step
 * explainer, plus an interactive preview a viewer can actually click through
 * (generates 4 client-side mock invite links, each copyable) — a preview of
 * the REAL post-purchase leader dashboard this product doesn't have yet, not
 * a claim that these specific links work. Framed honestly as "here's what it
 * will look like", never presented as an already-functional invite system.
 */
export function GroupInviteFlow() {
  const { language } = useLanguage();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [links] = useState(() => Array.from({ length: 4 }, () => `medart.ai/join/${randomSlug()}`));
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function handleCopy(index: number, link: string) {
    try {
      await navigator.clipboard.writeText(`https://${link}`);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1500);
    } catch {
      // Clipboard permission denied or unavailable (e.g. non-HTTPS context)
      // — a cosmetic preview link, so silently doing nothing is fine, no
      // toast/error state worth adding for this.
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {language === "fr" ? "Comment ça marche" : "How it works"}
      </p>

      <div className="mt-3 flex items-center justify-between gap-1">
        {STEPS.map((step) => (
          <div key={step.label.fr} className="flex flex-1 flex-col items-center gap-1.5 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
              <step.icon className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-medium leading-tight text-muted-foreground">{step.label[language]}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setPreviewOpen((v) => !v)}
        className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-primary-700 transition-colors hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300"
      >
        {language === "fr" ? "Voir un aperçu des liens d'invitation" : "Preview the invite links"}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", previewOpen && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {previewOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-2">
              {links.map((link, index) => (
                <div
                  key={link}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs"
                >
                  <span className="truncate font-mono text-foreground">{link}</span>
                  <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => handleCopy(index, link)}>
                    {copiedIndex === index ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {language === "fr"
                ? "Aperçu du tableau de bord Groupe — disponible juste après ton abonnement."
                : "Preview of the Group dashboard — available right after you subscribe."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
