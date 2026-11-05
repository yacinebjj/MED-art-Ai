"use client";

/**
 * Paramètres — every section except "Profil & Cursus" (which lives in the
 * page itself). Code-split: loaded only when the student opens one of these
 * tabs. Everything here is wired to something real:
 *  - Rappels: push opt-in, reminder cadence (profiles.flashcard_push_interval_minutes
 *    via PATCH /api/profile), priority modules (existing
 *    /api/modules/flashcards + /api/modules/[id]/flashcards);
 *  - Moteur IA: the real AI-content language store;
 *  - Apparence: next-themes + night mode, interface language;
 *  - Appareils: the devices actually subscribed to reminders, and Supabase
 *    sign-out (this device / every device).
 *
 * Presented with the page's grouped cards (components/settings/SettingsUI.tsx).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Bot, Brain, Check, Clock, Compass, Cpu, Globe2, Laptop, Loader2, LogOut, Monitor, MoonStar, ShieldAlert, Smartphone, Sparkles, Sun, Moon, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { PushOptInButton } from "@/components/push/PushOptInButton";
import { AiLanguageSelect } from "@/components/course/workspace/AiLanguageSelect";
import { UnifiedLanguageSwitch } from "@/components/layout/cockpit/UnifiedLanguageSwitch";
import { useThemeMode, THEME_MODE_LABELS, type ThemeMode } from "@/components/layout/cockpit/ThemeModeSwitcher";
import { SettingsCard, SettingsCardBody, SettingsRow, SettingsRows, SettingsSegmented } from "@/components/settings/SettingsUI";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/providers/LanguageProvider";
import { useOptionalOnboarding } from "@/lib/onboarding/onboarding-context";
import { FLASHCARD_PUSH_INTERVALS, type FlashcardPushInterval } from "@/lib/push/cadence";
import type { CurriculumYearData } from "@/types/academic";

// ── Rappels ──────────────────────────────────────────────────────────────

interface ReminderSettings {
  intervalMinutes: number;
  cadenceAvailable: boolean;
  devices: { endpoint: string; platform: string }[];
}

interface ModuleChip {
  id: number;
  title: string;
}

export function RemindersSection() {
  const { toast } = useToast();
  const { language } = useLanguage();
  const fr = language === "fr";
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [savingInterval, setSavingInterval] = useState(false);
  const [modules, setModules] = useState<ModuleChip[] | null>(null);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [pendingModule, setPendingModule] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [profileBody, activeBody] = await Promise.all([
          fetch("/api/profile").then((r) => r.json()),
          fetch("/api/modules/flashcards").then((r) => r.json()).catch(() => ({ activeModuleIds: [] })),
        ]);
        if (cancelled) return;
        if (profileBody?.reminders) setSettings(profileBody.reminders as ReminderSettings);
        setActiveIds(new Set<number>(Array.isArray(activeBody?.activeModuleIds) ? activeBody.activeModuleIds : []));

        const specialtyName: string | undefined = profileBody?.profile?.specialty?.name;
        const level: number | undefined = profileBody?.profile?.academicYear?.level;
        if (!specialtyName || !level) {
          setModules([]);
          return;
        }
        const res = await fetch(`/api/curriculum?specialty=${encodeURIComponent(specialtyName)}&level=${level}`);
        const curriculum: CurriculumYearData = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setModules([]);
          return;
        }
        const list: ModuleChip[] = [
          ...curriculum.teachingUnits.flatMap((unit) => unit.modules.map((m) => ({ id: m.id, title: m.title }))),
          ...curriculum.independentModules.map((m) => ({ id: m.id, title: m.title })),
        ];
        setModules(list);
      } catch {
        if (!cancelled) setModules([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function changeInterval(next: FlashcardPushInterval) {
    if (!settings || next === settings.intervalMinutes) return;
    const previous = settings.intervalMinutes;
    setSettings({ ...settings, intervalMinutes: next }); // optimistic
    setSavingInterval(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flashcardPushIntervalMinutes: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Enregistrement impossible.");
      toast({ variant: "success", title: fr ? "Fréquence des rappels enregistrée" : "Reminder frequency saved" });
    } catch (error) {
      setSettings((s) => (s ? { ...s, intervalMinutes: previous } : s));
      toast({ variant: "error", title: fr ? "Fréquence non modifiée" : "Frequency not changed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSavingInterval(false);
    }
  }

  async function toggleModule(id: number) {
    const next = !activeIds.has(id);
    setPendingModule(id);
    setActiveIds((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
    try {
      const res = await fetch(`/api/modules/${id}/flashcards`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setActiveIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(id);
        else copy.add(id);
        return copy;
      });
      toast({ variant: "error", title: fr ? "Module non modifié" : "Module not updated" });
    } finally {
      setPendingModule(null);
    }
  }

  const intervalLabel = (minutes: number) => (minutes === 60 ? (fr ? "Toutes les heures" : "Every hour") : fr ? `Toutes les ${minutes / 60} h` : `Every ${minutes / 60} h`);

  return (
    <div className="space-y-5">
      <SettingsCard
        icon={BellRing}
        title={fr ? "Rappels Flashcards" : "Flashcard reminders"}
        description={fr ? "Une notification avec une flashcard de tes modules prioritaires, même onglet fermé." : "A notification with a flashcard from your priority modules, even with the tab closed."}
      >
        <SettingsCardBody>
          <div className="max-w-full overflow-hidden">
            <PushOptInButton />
          </div>
        </SettingsCardBody>
      </SettingsCard>

      <SettingsCard
        icon={Clock}
        title={fr ? "Fréquence" : "Frequency"}
        description={fr ? "Exactement 1 rappel par intervalle, quel que soit le nombre d'appareils." : "Exactly 1 reminder per interval, whatever the number of devices."}
      >
        <SettingsCardBody>
          {!settings ? (
            <div className="h-11 w-full max-w-sm animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.05]" />
          ) : (
            <>
              <SettingsSegmented<string>
                ariaLabel={fr ? "Fréquence des rappels" : "Reminder frequency"}
                value={String(settings.intervalMinutes)}
                onChange={(value) => void changeInterval(Number(value) as FlashcardPushInterval)}
                options={FLASHCARD_PUSH_INTERVALS.map((minutes) => ({ value: String(minutes), label: minutes === 60 ? "1 h" : `${minutes / 60} h` }))}
              />
              <p className="mt-2.5 flex items-center gap-1.5 text-[0.8125rem] text-slate-500 dark:text-white/50">
                {savingInterval && <Loader2 className="h-3 w-3 animate-spin" />}
                {intervalLabel(settings.intervalMinutes)}
                {!settings.cadenceAvailable && (fr ? " — réglage actif après la prochaine mise à jour du serveur." : " — active after the next server update.")}
              </p>
            </>
          )}
        </SettingsCardBody>
      </SettingsCard>

      <SettingsCard
        icon={Brain}
        title={fr ? "Modules prioritaires" : "Priority modules"}
        description={fr ? "Les rappels et les flashcards piochent uniquement dans ces modules." : "Reminders and flashcards only draw from these modules."}
      >
        <SettingsCardBody>
          {modules === null ? (
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-10 w-32 animate-pulse rounded-full bg-slate-100 dark:bg-white/[0.05]" />
              ))}
            </div>
          ) : modules.length === 0 ? (
            <p className="text-[0.875rem] text-slate-500 dark:text-white/50">{fr ? "Choisis d'abord ta spécialité et ton année dans « Profil & Cursus »." : "Pick your specialty and year in “Profile” first."}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {modules.map((module) => {
                const active = activeIds.has(module.id);
                return (
                  <button
                    key={module.id}
                    type="button"
                    onClick={() => void toggleModule(module.id)}
                    disabled={pendingModule === module.id}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-[0.875rem] font-semibold transition-[border-color,background-color,color] active:scale-95 disabled:opacity-60",
                      active
                        ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-100"
                        : "border-black/[0.08] text-slate-600 hover:border-black/[0.16] hover:text-slate-900 dark:border-white/10 dark:text-white/60 dark:hover:border-white/25 dark:hover:text-white"
                    )}
                  >
                    {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    <span className="truncate">{module.title}</span>
                  </button>
                );
              })}
            </div>
          )}
        </SettingsCardBody>
      </SettingsCard>
    </div>
  );
}

// ── Moteur IA ────────────────────────────────────────────────────────────

export function AiEngineSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  return (
    <div className="space-y-5">
      <SettingsCard icon={Globe2} title={fr ? "Langue des contenus IA" : "AI content language"}>
        <SettingsRows>
          <SettingsRow
            label={fr ? "Langue de génération" : "Generation language"}
            description={fr ? "Langue des explications, QCM, flashcards et résumés générés." : "Language of generated explanations, MCQs, flashcards and summaries."}
          >
            <AiLanguageSelect />
          </SettingsRow>
        </SettingsRows>
      </SettingsCard>

      <SettingsCard
        icon={Cpu}
        title="MedArt Neural Engine"
        description={fr ? "MedArt choisit automatiquement le modèle le plus adapté à chaque tâche." : "MedArt automatically picks the best-suited model for each task."}
      >
        <SettingsRows>
          {[
            { icon: Sparkles, label: fr ? "Explications, résumés, cas cliniques" : "Explanations, summaries, clinical cases", value: fr ? "Analyse Médicale Avancée" : "Advanced Medical Analysis" },
            { icon: Brain, label: fr ? "Flashcards & QCM" : "Flashcards & MCQs", value: fr ? "Clinique Standard" : "Clinical Standard" },
            { icon: Bot, label: "Lab IA", value: fr ? "Raisonnement Clinique Expert" : "Expert Clinical Reasoning" },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex flex-col gap-1.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
              <span className="flex min-w-0 items-center gap-2.5 text-[0.875rem] text-slate-700 dark:text-white/80">
                <Icon className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
                <span>{label}</span>
              </span>
              <span className="self-start rounded-full bg-slate-100 px-2.5 py-1 text-[0.75rem] font-semibold text-slate-700 dark:bg-white/[0.06] dark:text-white/85 sm:self-auto sm:shrink-0">
                {value}
              </span>
            </div>
          ))}
        </SettingsRows>
        <p className="border-t border-black/[0.05] px-5 py-3.5 text-[0.75rem] leading-relaxed text-slate-500 dark:border-white/[0.06] dark:text-white/40 sm:px-6">
          {fr
            ? "Le choix manuel du modèle, du niveau de détail et du style des mnémotechniques arrivera dans une prochaine version : ils demandent d'adapter chaque générateur côté serveur."
            : "Manual model choice, detail level and mnemonic style are coming in a future version: each generator has to be adapted server-side."}
        </p>
      </SettingsCard>
    </div>
  );
}

// ── Apparence ────────────────────────────────────────────────────────────

const THEME_CARDS: { mode: ThemeMode; icon: typeof Sun; preview: string }[] = [
  { mode: "light", icon: Sun, preview: "bg-gradient-to-br from-white to-slate-100 border-slate-200" },
  { mode: "dark", icon: Moon, preview: "bg-gradient-to-br from-slate-900 to-slate-950 border-slate-700" },
  { mode: "night", icon: MoonStar, preview: "bg-gradient-to-br from-slate-900 to-amber-950/70 border-amber-900/50" },
];

export function AppearanceSection() {
  const { language } = useLanguage();
  const onboarding = useOptionalOnboarding();
  const fr = language === "fr";
  const { current, select } = useThemeMode();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-5">
      <SettingsCard icon={Monitor} title={fr ? "Thème" : "Theme"} description={fr ? "Appliqué à toute l'application, instantanément." : "Applied to the whole app, instantly."}>
        <SettingsCardBody>
          <div role="radiogroup" aria-label={fr ? "Thème" : "Theme"} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {THEME_CARDS.map(({ mode, icon: Icon, preview }) => {
              const active = mounted && current === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={(event) => select(mode, event.currentTarget)}
                  className={cn(
                    "group flex items-center gap-3 rounded-2xl border p-2.5 text-left transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 sm:flex-col sm:items-stretch",
                    active
                      ? "border-sky-500/70 shadow-[0_0_0_3px_rgba(14,165,233,0.15)] dark:border-sky-400/70"
                      : "border-black/[0.08] hover:border-black/[0.16] dark:border-white/10 dark:hover:border-white/25"
                  )}
                >
                  <span className={cn("flex h-14 w-20 shrink-0 items-end rounded-xl border p-1.5 sm:h-20 sm:w-full", preview)}>
                    <span className="h-2 w-1/2 rounded-full bg-sky-400/80" />
                  </span>
                  <span className="flex flex-1 items-center justify-between gap-2 sm:px-1 sm:pb-0.5">
                    <span className="flex items-center gap-2 text-[0.875rem] font-semibold text-slate-900 dark:text-white">
                      <Icon className={cn("h-4 w-4", mode === "night" ? "text-amber-500 dark:text-amber-400" : "text-sky-600 dark:text-sky-300")} />
                      {THEME_MODE_LABELS[mode][language]}
                    </span>
                    {active && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-white">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </SettingsCardBody>
      </SettingsCard>

      <SettingsCard icon={Globe2} title={fr ? "Langue de l'interface" : "Interface language"}>
        <SettingsRows>
          <SettingsRow label={fr ? "Langue" : "Language"} description={fr ? "Menus, boutons et messages de l'application." : "The app's menus, buttons and messages."}>
            <UnifiedLanguageSwitch />
          </SettingsRow>
        </SettingsRows>
      </SettingsCard>

      {onboarding && (
        <SettingsCard icon={Compass} title={fr ? "Visite guidée" : "Guided tour"}>
          <SettingsRows>
            <SettingsRow label={fr ? "Revoir le guide" : "Replay the tour"} description={fr ? "Les 5 outils de MedArt AI en une minute, sur ton tableau de bord." : "MedArt AI's 5 tools in one minute, on your dashboard."}>
              <Button type="button" variant="outline" onClick={onboarding.start} className="w-full gap-2 sm:w-auto">
                <Compass className="h-4 w-4" />
                {fr ? "Revoir le guide" : "Replay the tour"}
              </Button>
            </SettingsRow>
          </SettingsRows>
        </SettingsCard>
      )}
    </div>
  );
}

// ── Appareils & sessions ─────────────────────────────────────────────────

function describeCurrentDevice(): { label: string; icon: typeof Laptop } {
  if (typeof navigator === "undefined") return { label: "", icon: Laptop };
  const ua = navigator.userAgent;
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = isIpad ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const mobile = isIpad || /iPhone|Android/.test(ua);
  return { label: [browser, os].filter(Boolean).join(" · ") || "Navigateur", icon: mobile ? Smartphone : Laptop };
}

export function DevicesSection() {
  const router = useRouter();
  const { toast } = useToast();
  const { language } = useLanguage();
  const fr = language === "fr";
  const [devices, setDevices] = useState<ReminderSettings["devices"] | null>(null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState<"local" | "global" | null>(null);
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  // Read after mount: navigator differs between the server render and the browser.
  const [current, setCurrent] = useState<{ label: string; icon: typeof Laptop }>({ label: "", icon: Laptop });
  useEffect(() => setCurrent(describeCurrentDevice()), []);

  const load = useCallback(async () => {
    const body = await fetch("/api/profile")
      .then((r) => r.json())
      .catch(() => null);
    setDevices(Array.isArray(body?.reminders?.devices) ? body.reminders.devices : []);
  }, []);

  useEffect(() => {
    void load();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then(async (registration) => {
        const subscription = await registration?.pushManager.getSubscription();
        setThisEndpoint(subscription?.endpoint ?? null);
      }).catch(() => undefined);
    }
  }, [load]);

  async function removeDevice(endpoint: string) {
    setRemoving(endpoint);
    try {
      const res = await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) });
      if (!res.ok) throw new Error();
      setDevices((prev) => (prev ?? []).filter((d) => d.endpoint !== endpoint));
      toast({ variant: "success", title: fr ? "Appareil retiré des rappels" : "Device removed from reminders" });
    } catch {
      toast({ variant: "error", title: fr ? "Impossible de retirer cet appareil" : "Couldn't remove this device" });
    } finally {
      setRemoving(null);
    }
  }

  async function signOut(scope: "local" | "global") {
    setSigningOut(scope);
    const { error } = await createClient().auth.signOut({ scope });
    if (error) {
      setSigningOut(null);
      toast({ variant: "error", title: fr ? "Déconnexion impossible" : "Sign-out failed", description: error.message });
      return;
    }
    router.push("/login");
    router.refresh();
  }

  const CurrentIcon = current.icon;

  return (
    <div className="space-y-5">
      <SettingsCard icon={CurrentIcon} title={fr ? "Cet appareil" : "This device"}>
        <SettingsRows>
          <SettingsRow label={current.label || (fr ? "Navigateur" : "Browser")} description={fr ? "Le navigateur que tu utilises en ce moment." : "The browser you're using right now."}>
            <Button variant="outline" onClick={() => void signOut("local")} disabled={signingOut !== null} className="w-full sm:w-auto">
              {signingOut === "local" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              {fr ? "Se déconnecter de cet appareil" : "Sign out of this device"}
            </Button>
          </SettingsRow>
        </SettingsRows>
      </SettingsCard>

      <SettingsCard
        icon={BellRing}
        title={fr ? "Appareils qui reçoivent les rappels" : "Devices receiving reminders"}
        description={fr ? "PC, téléphone, iPad : chaque navigateur où tu as activé les rappels." : "PC, phone, iPad: every browser where reminders are on."}
      >
        {devices === null ? (
          <SettingsCardBody className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.04]" />
            ))}
          </SettingsCardBody>
        ) : devices.length === 0 ? (
          <SettingsCardBody>
            <p className="text-[0.875rem] text-slate-500 dark:text-white/50">{fr ? "Aucun appareil n'est abonné aux rappels." : "No device is subscribed to reminders."}</p>
          </SettingsCardBody>
        ) : (
          <SettingsRows>
            {devices.map((device) => {
              const isThis = device.endpoint === thisEndpoint;
              return (
                <div key={device.endpoint} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                  <span className="flex min-w-0 items-center gap-2.5 text-[0.875rem] text-slate-700 dark:text-white/85">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sky-600 dark:bg-white/[0.06] dark:text-sky-300">
                      <Smartphone className="h-4 w-4" />
                    </span>
                    <span className="truncate">{device.platform}</span>
                    {isThis && (
                      <span className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
                        {fr ? "Cet appareil" : "This device"}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeDevice(device.endpoint)}
                    disabled={removing === device.endpoint}
                    aria-label={fr ? "Retirer cet appareil des rappels" : "Remove this device from reminders"}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-50 dark:text-white/40 dark:hover:bg-rose-500/15 dark:hover:text-rose-300"
                  >
                    {removing === device.endpoint ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              );
            })}
          </SettingsRows>
        )}
      </SettingsCard>

      <SettingsCard tone="danger" icon={ShieldAlert} title={fr ? "Toutes les sessions" : "All sessions"}>
        <SettingsRows>
          <SettingsRow
            label={fr ? "Déconnecter tous les appareils" : "Sign out everywhere"}
            description={fr ? "Déconnecte ton compte de tous les appareils (PC, mobile, iPad), y compris celui-ci." : "Signs your account out everywhere (PC, phone, iPad), including this device."}
          >
            <Button variant="danger" onClick={() => setConfirmGlobal(true)} disabled={signingOut !== null} className="w-full sm:w-auto">
              <LogOut className="h-4 w-4" />
              {fr ? "Déconnecter tous les appareils" : "Sign out everywhere"}
            </Button>
          </SettingsRow>
        </SettingsRows>
      </SettingsCard>

      <Dialog open={confirmGlobal} onOpenChange={setConfirmGlobal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{fr ? "Déconnecter tous les appareils ?" : "Sign out everywhere?"}</DialogTitle>
            <DialogDescription>
              {fr ? "Tu devras te reconnecter sur chaque appareil. Tes cours et tes données restent intacts." : "You'll need to sign in again on every device. Your courses and data stay intact."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmGlobal(false)}>
              {fr ? "Annuler" : "Cancel"}
            </Button>
            <Button variant="danger" onClick={() => void signOut("global")} disabled={signingOut !== null}>
              {signingOut === "global" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              {fr ? "Tout déconnecter" : "Sign out everywhere"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
