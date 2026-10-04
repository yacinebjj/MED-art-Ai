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
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Bot, Brain, Check, Clock, Cpu, Globe2, Laptop, Loader2, LogOut, Monitor, MoonStar, ShieldAlert, Smartphone, Sparkles, Sun, Moon, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { PushOptInButton } from "@/components/push/PushOptInButton";
import { AiLanguageSelect } from "@/components/course/workspace/AiLanguageSelect";
import { UnifiedLanguageSwitch } from "@/components/layout/cockpit/UnifiedLanguageSwitch";
import { useThemeMode, THEME_MODE_LABELS, type ThemeMode } from "@/components/layout/cockpit/ThemeModeSwitcher";
import { CyberPanel, SegmentedControl } from "@/components/cyber/primitives";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/providers/LanguageProvider";
import { FLASHCARD_PUSH_INTERVALS, type FlashcardPushInterval } from "@/lib/push/cadence";
import type { CurriculumYearData } from "@/types/academic";

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof Bot; title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-inset ring-cyan-400/25">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-black text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
    </div>
  );
}

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
      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle
          icon={BellRing}
          title={fr ? "Rappels Flashcards" : "Flashcard reminders"}
          subtitle={fr ? "Une notification avec une flashcard de tes modules prioritaires, même onglet fermé." : "A notification with a flashcard from your priority modules, even with the tab closed."}
        />
        <div className="max-w-full overflow-hidden">
          <PushOptInButton />
        </div>
      </CyberPanel>

      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle
          icon={Clock}
          title={fr ? "Fréquence" : "Frequency"}
          subtitle={fr ? "Exactement 1 rappel par intervalle, quel que soit le nombre d'appareils." : "Exactly 1 reminder per interval, whatever the number of devices."}
        />
        {!settings ? (
          <div className="h-11 w-full max-w-sm animate-pulse rounded-2xl bg-white/[0.04]" />
        ) : (
          <>
            <SegmentedControl<string>
              ariaLabel={fr ? "Fréquence des rappels" : "Reminder frequency"}
              value={String(settings.intervalMinutes)}
              onChange={(value) => void changeInterval(Number(value) as FlashcardPushInterval)}
              options={FLASHCARD_PUSH_INTERVALS.map((minutes) => ({ value: String(minutes), label: minutes === 60 ? "1 h" : `${minutes / 60} h` }))}
            />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              {savingInterval && <Loader2 className="h-3 w-3 animate-spin" />}
              {intervalLabel(settings.intervalMinutes)}
              {!settings.cadenceAvailable && (fr ? " — réglage actif après la prochaine mise à jour du serveur." : " — active after the next server update.")}
            </p>
          </>
        )}
      </CyberPanel>

      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle
          icon={Brain}
          title={fr ? "Modules prioritaires" : "Priority modules"}
          subtitle={fr ? "Les rappels et les flashcards piochent uniquement dans ces modules." : "Reminders and flashcards only draw from these modules."}
        />
        {modules === null ? (
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-10 w-32 animate-pulse rounded-full bg-white/[0.04]" />
            ))}
          </div>
        ) : modules.length === 0 ? (
          <p className="text-sm text-slate-400">{fr ? "Choisis d'abord ta spécialité et ton année dans « Profil & Cursus »." : "Pick your specialty and year in “Profile” first."}</p>
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
                    "inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-[border-color,background-color,color] active:scale-95 disabled:opacity-60",
                    active ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100" : "border-white/10 text-slate-400 hover:border-white/25 hover:text-white"
                  )}
                >
                  {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  <span className="truncate">{module.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </CyberPanel>
    </div>
  );
}

// ── Moteur IA ────────────────────────────────────────────────────────────

export function AiEngineSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  return (
    <div className="space-y-5">
      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle
          icon={Globe2}
          title={fr ? "Langue des contenus IA" : "AI content language"}
          subtitle={fr ? "Langue des explications, QCM, flashcards et résumés générés." : "Language of generated explanations, MCQs, flashcards and summaries."}
        />
        <AiLanguageSelect />
      </CyberPanel>

      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle
          icon={Cpu}
          title="MedArt Neural Engine"
          subtitle={fr ? "MedArt choisit automatiquement le modèle le plus adapté à chaque tâche." : "MedArt automatically picks the best-suited model for each task."}
        />
        <ul className="space-y-2 text-sm">
          {[
            { icon: Sparkles, label: fr ? "Explications, résumés, cas cliniques" : "Explanations, summaries, clinical cases", value: fr ? "Analyse Médicale Avancée" : "Advanced Medical Analysis" },
            { icon: Brain, label: fr ? "Flashcards & QCM" : "Flashcards & MCQs", value: fr ? "Clinique Standard" : "Clinical Standard" },
            { icon: Bot, label: "Lab IA", value: fr ? "Raisonnement Clinique Expert" : "Expert Clinical Reasoning" },
          ].map(({ icon: Icon, label, value }) => (
            <li key={label} className="flex flex-col gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="flex min-w-0 items-center gap-2 text-slate-300">
                <Icon className="h-4 w-4 shrink-0 text-cyan-300" />
                <span>{label}</span>
              </span>
              <span className="pl-6 text-xs font-bold text-white sm:shrink-0 sm:pl-0">{value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-slate-500">
          {fr
            ? "Le choix manuel du modèle, du niveau de détail et du style des mnémotechniques arrivera dans une prochaine version : ils demandent d'adapter chaque générateur côté serveur."
            : "Manual model choice, detail level and mnemonic style are coming in a future version: each generator has to be adapted server-side."}
        </p>
      </CyberPanel>
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
  const fr = language === "fr";
  const { current, select } = useThemeMode();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-5">
      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle icon={Monitor} title={fr ? "Thème" : "Theme"} subtitle={fr ? "Appliqué à toute l'application, instantanément." : "Applied to the whole app, instantly."} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEME_CARDS.map(({ mode, icon: Icon, preview }) => {
            const active = mounted && current === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => select(mode)}
                aria-pressed={active}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl border p-3 text-left transition-[border-color,box-shadow] sm:flex-col sm:items-stretch",
                  active ? "border-cyan-400/70 shadow-[0_0_24px_-8px_rgba(34,211,238,0.7)]" : "border-white/10 hover:border-white/25"
                )}
              >
                <span className={cn("flex h-14 w-20 shrink-0 items-end rounded-xl border p-1.5 sm:h-20 sm:w-full", preview)}>
                  <span className="h-2 w-1/2 rounded-full bg-cyan-400/70" />
                </span>
                <span className="flex flex-1 items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-bold text-white">
                    <Icon className={cn("h-4 w-4", mode === "night" ? "text-amber-400" : "text-cyan-300")} />
                    {THEME_MODE_LABELS[mode][language]}
                  </span>
                  {active && <Check className="h-4 w-4 text-cyan-300" />}
                </span>
              </button>
            );
          })}
        </div>
      </CyberPanel>

      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle icon={Globe2} title={fr ? "Langue de l'interface" : "Interface language"} />
        <UnifiedLanguageSwitch />
      </CyberPanel>
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
      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle icon={CurrentIcon} title={fr ? "Cet appareil" : "This device"} subtitle={current.label} />
        <Button variant="outline" onClick={() => void signOut("local")} disabled={signingOut !== null} className="w-full sm:w-auto">
          {signingOut === "local" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {fr ? "Se déconnecter de cet appareil" : "Sign out of this device"}
        </Button>
      </CyberPanel>

      <CyberPanel className="p-5 sm:p-6">
        <SectionTitle
          icon={BellRing}
          title={fr ? "Appareils qui reçoivent les rappels" : "Devices receiving reminders"}
          subtitle={fr ? "PC, téléphone, iPad : chaque navigateur où tu as activé les rappels." : "PC, phone, iPad: every browser where reminders are on."}
        />
        {devices === null ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <p className="text-sm text-slate-400">{fr ? "Aucun appareil n'est abonné aux rappels." : "No device is subscribed to reminders."}</p>
        ) : (
          <ul className="space-y-2">
            {devices.map((device) => {
              const isThis = device.endpoint === thisEndpoint;
              return (
                <li key={device.endpoint} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-slate-200">
                    <Smartphone className="h-4 w-4 shrink-0 text-cyan-300" />
                    <span className="truncate">{device.platform}</span>
                    {isThis && <span className="shrink-0 rounded-full bg-cyan-400/15 px-2 py-0.5 text-[10px] font-bold text-cyan-200">{fr ? "Cet appareil" : "This device"}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeDevice(device.endpoint)}
                    disabled={removing === device.endpoint}
                    aria-label={fr ? "Retirer cet appareil des rappels" : "Remove this device from reminders"}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-50"
                  >
                    {removing === device.endpoint ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CyberPanel>

      <CyberPanel className="border-rose-400/20 p-5 sm:p-6">
        <SectionTitle
          icon={ShieldAlert}
          title={fr ? "Toutes les sessions" : "All sessions"}
          subtitle={fr ? "Déconnecte ton compte de tous les appareils (PC, mobile, iPad), y compris celui-ci." : "Signs your account out everywhere (PC, phone, iPad), including this device."}
        />
        <Button variant="danger" onClick={() => setConfirmGlobal(true)} disabled={signingOut !== null} className="w-full sm:w-auto">
          <LogOut className="h-4 w-4" />
          {fr ? "Déconnecter tous les appareils" : "Sign out everywhere"}
        </Button>
      </CyberPanel>

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
