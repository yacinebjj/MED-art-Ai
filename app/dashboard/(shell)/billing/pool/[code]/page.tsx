"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, animate, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  CalendarCheck,
  Check,
  Clock,
  Copy,
  CreditCard,
  Crown,
  Hourglass,
  Loader2,
  Lock,
  LogOut,
  PartyPopper,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Undo2,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { CyberHeader, CyberPanel, CyberStage, NeonRing, ParticleBurst } from "@/components/cyber/primitives";
import { PAYMENT_CONFIRM_GRACE_MINUTES, PLANS, POOL_DEADLINE_DAYS, REFUND_DELAY_LABEL, formatDZD, type BillingCycle, type PlanId, SEAT_HOLD_MINUTES } from "@/lib/pricing";
import type { PoolView } from "@/lib/billing-pools";
import { cn } from "@/lib/utils";

/** lib/billing-pools.ts HOLD_MINUTES (server-only constant, not importable here). */
const HOLD_MINUTES = SEAT_HOLD_MINUTES;
const CONFIRM_POLL_MS = 4000;
const CONFIRM_POLL_MAX_MS = 2 * 60 * 1000;
const LIVE_REFRESH_MS = 20000;
/** Above this many seats the seat dots shrink (Groupe de 10, and older 15/40-seat pools). */
const GRID_BREAK = 5;

const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quad: 4, annual: 8 };
const CYCLE_DURATION: Record<BillingCycle, string> = { monthly: "1 mois", quad: "4 mois", annual: "8 mois (l'année d'études)" };
const CYCLE_SUFFIX: Record<BillingCycle, string> = { monthly: "", quad: " (4 mois)", annual: " (année, 8 mois)" };

type MemberStatus = PoolView["me"]["status"];

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; status: number; message: string }
  | { kind: "ready"; pool: PoolView };

type ConfirmPhase = "idle" | "polling" | "timeout";

type PoolAction = "checkout" | "join" | "leave";

type Phase =
  | "refunded"
  | "refund_pending"
  | "celebrate"
  | "paid_waiting"
  | "holding"
  | "expired_outsider"
  | "full_outsider"
  | "join"
  | "pay";

interface ApiPoolResponse {
  success: boolean;
  pool?: PoolView;
  checkoutUrl?: string;
  error?: string;
}

function isSettledPayment(status: MemberStatus): boolean {
  return status === "paid" || status === "activated" || status === "refund_pending" || status === "refunded";
}

function resolvePhase(pool: PoolView): Phase {
  const { me } = pool;
  if (me.refund?.status === "refunded" || me.status === "refunded") return "refunded";
  if (me.refund?.status === "pending" || me.status === "refund_pending") return "refund_pending";
  if (me.status === "activated") return "celebrate";
  if (me.status === "paid") {
    if (pool.status === "complete") return "celebrate";
    if (pool.status === "expired") return "refund_pending";
    return "paid_waiting";
  }
  if (me.status === "holding" && pool.status === "open") return "holding";
  // A leader's group is « complete » from the start (all seats paid): friends join until it is full.
  if (pool.mode === "leader") return pool.confirmed >= pool.size ? "full_outsider" : "join";
  if (pool.status === "expired") return "expired_outsider";
  if (pool.status === "complete" || pool.confirmed >= pool.size) return "full_outsider";
  return "pay";
}

function formatFrenchDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Échéance atteinte";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Il reste ${days} j ${hours} h`;
  if (hours > 0) return `Il reste ${hours} h ${minutes} min`;
  return `Il reste ${Math.max(1, minutes)} min`;
}

function accessEndIso(pool: PoolView): string | null {
  if (pool.periodEnd) return pool.periodEnd;
  if (!pool.completedAt) return null;
  const end = new Date(pool.completedAt);
  end.setMonth(end.getMonth() + CYCLE_MONTHS[pool.cycle]);
  return end.toISOString();
}

function soloPrice(cycle: BillingCycle): number {
  return PLANS[`individual_${cycle}` as PlanId].priceDZD;
}

function inviteUrl(origin: string, pool: PoolView): string {
  const kind = pool.mode === "leader" ? "lead" : pool.kind;
  return `${origin}/join/${pool.code}?k=${kind}`;
}

/** Pre-written group-chat message. `url` omitted → text only (Telegram adds the link itself). */
function inviteMessage(pool: PoolView, url: string | null): string {
  const link = url ? ` ici : ${url}` : " ici";
  if (pool.mode === "leader") {
    return `🎓 Je t'ai réservé une place dans mon groupe MedArt AI — elle est déjà payée, tu n'as rien à payer. Rejoins-nous${link}`;
  }
  const price = `${formatDZD(pool.pricePerMember)}/personne${CYCLE_SUFFIX[pool.cycle]}`;
  const solo = formatDZD(soloPrice(pool.cycle));
  const who = `à ${pool.size}`;
  return `🎓 On débloque MedArt AI ${who} à ${price} au lieu de ${solo} ! Il faut être exactement ${pool.size} — rejoins-nous${link} (si on n'est pas ${pool.size} en ${POOL_DEADLINE_DAYS} jours, chacun est remboursé).`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the legacy path (insecure context, denied permission).
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function AnimatedCount({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const previous = useRef(0);
  useEffect(() => {
    const controls = animate(previous.current, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    previous.current = value;
    return () => controls.stop();
  }, [value]);
  return <>{display}</>;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Gauge({ pool, phase }: { pool: PoolView; phase: Phase }) {
  const ratio = pool.size > 0 ? pool.confirmed / pool.size : 0;
  // Starts empty and fills on mount so the student sees the gauge move.
  const [ringValue, setRingValue] = useState(0);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setRingValue(ratio));
    return () => window.cancelAnimationFrame(id);
  }, [ratio]);

  const complete = pool.confirmed >= pool.size || pool.status === "complete";
  const expired = pool.status === "expired" && !complete;
  const colors = complete ? ["#34d399", "#22d3ee"] : expired ? ["#94a3b8", "#64748b"] : ["#22d3ee", "#8b5cf6"];
  const now = useNow(30000);
  const showCountdown = pool.mode === "pooled" && pool.status === "open";
  const remainingMs = new Date(pool.expiresAt).getTime() - now;
  const unit = pool.mode === "leader" ? "places prises" : "places payées";

  return (
    <div className="flex flex-col items-center text-center">
      <NeonRing
        value={ringValue}
        size={208}
        stroke={14}
        ticks={pool.size * 4}
        from={colors[0]}
        to={colors[1]}
        aria-label={`${pool.confirmed} sur ${pool.size} ${unit}`}
      >
        <span className="text-5xl font-black tabular-nums text-white">
          <AnimatedCount value={pool.confirmed} />
          <span className="text-2xl text-slate-500">/{pool.size}</span>
        </span>
        <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{unit}</span>
      </NeonRing>

      <div className="mt-5 grid grid-cols-5 gap-2" aria-hidden>
        {Array.from({ length: pool.size }, (_, i) => {
          const filled = i < pool.confirmed;
          return (
            <motion.span
              key={i}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.04, type: "spring", stiffness: 380, damping: 22 }}
              className={cn(
                "flex items-center justify-center rounded-full border",
                pool.size > GRID_BREAK ? "h-7 w-7" : "h-10 w-10",
                filled
                  ? complete
                    ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300"
                    : "border-cyan-400/60 bg-cyan-500/20 text-cyan-300"
                  : "border-white/10 bg-white/[0.03] text-slate-600"
              )}
            >
              {filled ? <Check className={pool.size > GRID_BREAK ? "h-3.5 w-3.5" : "h-4 w-4"} /> : <Users className="h-3 w-3" />}
            </motion.span>
          );
        })}
      </div>

      {showCountdown && (
        <p
          className={cn(
            "mt-5 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold tabular-nums",
            remainingMs < 24 * 3600 * 1000 ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/[0.04] text-slate-200"
          )}
        >
          <Clock className="h-4 w-4" />
          {formatRemaining(remainingMs)}
        </p>
      )}
      {phase === "celebrate" && <p className="mt-4 text-sm font-semibold text-emerald-300">Objectif atteint 🎉</p>}
    </div>
  );
}

function Banner({ tone, icon: Icon, title, children }: { tone: "emerald" | "rose" | "amber" | "cyan"; icon: typeof Check; title: string; children?: ReactNode }) {
  const toneClass = {
    emerald: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    rose: "border-rose-400/40 bg-rose-500/10 text-rose-200",
    amber: "border-amber-400/40 bg-amber-500/10 text-amber-200",
    cyan: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
  }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-start gap-3 rounded-2xl border p-4 text-sm", toneClass)}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        {children && <div className="mt-1 leading-relaxed text-slate-300">{children}</div>}
      </div>
    </motion.div>
  );
}

function TrustList({ pool }: { pool: PoolView }) {
  const items =
    pool.mode === "leader"
      ? [
          { icon: ShieldCheck, text: "Les places de ce groupe ont déjà été payées par son créateur : rejoindre ne coûte rien." },
          { icon: Lock, text: "Ton compte reste privé : les autres membres ne voient ni tes cours ni tes données." },
        ]
      : [
          { icon: CreditCard, text: "Paiement sécurisé par Chargily Pay (Edahabia / CIB). MedArt AI ne voit jamais ta carte." },
          { icon: Hourglass, text: `Ta place est réservée ${HOLD_MINUTES} minutes pendant le paiement.` },
          { icon: Undo2, text: `Objectif non atteint sous ${POOL_DEADLINE_DAYS} jours ? Le remboursement est déclenché automatiquement, reçu sous ${REFUND_DELAY_LABEL}.` },
        ];
  return (
    <ul className="space-y-2.5">
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-slate-300">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function Reassurance({ pool, paid }: { pool: PoolView; paid: boolean }) {
  const remaining = Math.max(0, pool.size - pool.confirmed);
  return (
    <p className="text-sm leading-relaxed text-slate-300">
      <span className="font-bold text-white">Ton argent est protégé.</span>{" "}
      {paid ? "Ta part est payée et ta place est bloquée. " : "Ta place n'est bloquée qu'une fois ta part payée. "}
      Encore <span className="font-bold text-white">{remaining}</span> paiement{remaining > 1 ? "s" : ""} et la jauge atteint{" "}
      <span className="font-bold text-white">
        {pool.size}/{pool.size}
      </span>
      : MedArt AI se débloque alors pour tout le monde, pour {CYCLE_DURATION[pool.cycle]}. Si le groupe n&apos;est pas complet sous {POOL_DEADLINE_DAYS} jours,
      chaque part payée ({formatDZD(pool.pricePerMember)}) est remboursée automatiquement — reçue sous {REFUND_DELAY_LABEL}.
    </p>
  );
}

type StepState = "done" | "current" | "todo";

/** « Where am I » for a pooled purchase: pay your share → invite → activation at size/size. */
function Steps({ pool, paid }: { pool: PoolView; paid: boolean }) {
  const complete = pool.status === "complete";
  const steps: { title: string; text: string; state: StepState }[] = [
    { title: "Paie ta part", text: formatDZD(pool.pricePerMember), state: paid || complete ? "done" : "current" },
    { title: "Invite tes amis", text: `${pool.confirmed}/${pool.size} payés`, state: complete ? "done" : paid ? "current" : "todo" },
    { title: `Activation à ${pool.size}/${pool.size}`, text: "pour tout le monde", state: complete ? "done" : "todo" },
  ];
  return (
    <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Étapes">
      {steps.map((step, index) => (
        <li
          key={step.title}
          aria-current={step.state === "current" ? "step" : undefined}
          className={cn(
            "rounded-2xl border px-3 py-2.5",
            step.state === "done" && "border-emerald-400/40 bg-emerald-500/10",
            step.state === "current" && "border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.18)]",
            step.state === "todo" && "border-white/10 bg-white/[0.02]"
          )}
        >
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black",
                step.state === "done" ? "bg-emerald-400 text-slate-950" : step.state === "current" ? "bg-cyan-300 text-slate-950" : "bg-white/10 text-slate-400"
              )}
            >
              {step.state === "done" ? <Check className="h-2.5 w-2.5" /> : index + 1}
            </span>
            Étape {index + 1}
          </p>
          <p className={cn("mt-1 text-xs font-black leading-tight sm:text-sm", step.state === "todo" ? "text-slate-400" : "text-white")}>{step.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}

function InvitePanel({ pool }: { pool: PoolView }) {
  const { toast } = useToast();
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const url = origin ? inviteUrl(origin, pool) : "";
  const message = url ? inviteMessage(pool, url) : "";
  const telegramHref = url
    ? `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(inviteMessage(pool, null))}`
    : undefined;
  const whatsappHref = url ? `https://wa.me/?text=${encodeURIComponent(message)}` : undefined;

  async function handleCopy() {
    if (!message) return;
    const ok = await copyText(message);
    if (ok) {
      setCopied(true);
      toast({ variant: "success", title: "Message copié !", description: "Colle-le dans le groupe de ta promo (Messenger, WhatsApp, Telegram…)." });
    } else {
      toast({ variant: "error", title: "Copie impossible", description: "Sélectionne le lien ci-dessous et copie-le manuellement." });
    }
  }

  async function handleShare() {
    if (!url) return;
    try {
      await navigator.share({ title: "MedArt AI", text: inviteMessage(pool, null), url });
    } catch {
      // Cancelled by the student — nothing to do.
    }
  }

  const remaining = Math.max(0, pool.size - pool.confirmed);

  return (
    <CyberPanel accent="violet" className="p-5 sm:p-6">
      <p className="cyber-kicker">Inviter</p>
      <h2 className="mt-1 text-lg font-black text-white">
        {pool.mode === "leader"
          ? `Encore ${remaining} place${remaining > 1 ? "s" : ""} à offrir`
          : `Plus que ${remaining} membre${remaining > 1 ? "s" : ""} à convaincre`}
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Le plus rapide : partager le message dans le groupe de tes amis.
      </p>

      <motion.button
        type="button"
        onClick={handleCopy}
        disabled={!message}
        whileTap={{ scale: 0.97 }}
        className={cn(
          "mt-5 flex h-16 w-full items-center justify-center gap-3 rounded-2xl px-5 text-base font-black text-slate-950 shadow-[0_0_30px_rgba(139,92,246,0.35)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-60",
          copied ? "bg-gradient-to-r from-emerald-300 to-teal-400" : "bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-400"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? "copied" : "copy"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-3"
          >
            {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            {copied ? "Message copié !" : "Copier le lien d'invitation"}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <div className={cn("mt-3 grid gap-2", canShare ? "grid-cols-3" : "grid-cols-2")}>
        {canShare && (
          <button
            type="button"
            onClick={handleShare}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2 text-xs font-bold text-slate-200 transition-colors hover:bg-white/10"
          >
            <Share2 className="h-4 w-4" />
            Partager
          </button>
        )}
        <a
          href={telegramHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2 text-xs font-bold text-sky-300 transition-colors hover:bg-white/10"
        >
          <Send className="h-4 w-4" />
          Telegram
        </a>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2 text-xs font-bold text-emerald-300 transition-colors hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
          </svg>
          WhatsApp
        </a>
      </div>

      {url && (
        <p className="mt-4 select-all break-all rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 font-mono text-xs text-slate-400">
          {url}
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Code du groupe : <span className="font-mono font-bold tracking-widest text-slate-300">{pool.code}</span>
      </p>
    </CyberPanel>
  );
}

function PoolTracker() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toUpperCase();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnStatus = searchParams.get("status");
  const { toast } = useToast();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>(returnStatus === "success" ? "polling" : "idle");
  const [busy, setBusy] = useState<PoolAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [showFailure, setShowFailure] = useState(returnStatus === "failure");

  const load = useCallback(async (): Promise<PoolView | null> => {
    try {
      const res = await fetch(`/api/billing/pools/${encodeURIComponent(code)}`, { cache: "no-store" });
      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`/dashboard/billing/pool/${code}`)}`);
        return null;
      }
      const data = (await res.json().catch(() => null)) as ApiPoolResponse | null;
      if (!res.ok || !data?.success || !data.pool) {
        setState((current) =>
          current.kind === "ready" && res.status >= 500
            ? current // Keep showing the last good tracker on a transient server error.
            : { kind: "error", status: res.status, message: data?.error ?? "Impossible de charger ce groupe." }
        );
        return null;
      }
      const pool = data.pool;
      setState({ kind: "ready", pool });
      return pool;
    } catch {
      setState((current) => (current.kind === "ready" ? current : { kind: "error", status: 0, message: "Connexion impossible. Vérifie ton réseau et réessaie." }));
      return null;
    }
  }, [code, router]);

  // Initial load.
  useEffect(() => {
    void load();
  }, [load]);

  // Back from Chargily with ?status=success: the webhook may lag, poll until the payment is attached.
  useEffect(() => {
    if (confirmPhase !== "polling") return;
    const startedAt = Date.now();
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      // Asks Chargily directly too, so a late or lost webhook never leaves a paid share unconfirmed.
      await fetch("/api/chargily/reconcile", { method: "POST", cache: "no-store" }).catch(() => undefined);
      if (cancelled) return;
      const pool = await load();
      if (cancelled) return;
      if (pool && isSettledPayment(pool.me.status)) return; // The effect below finishes the flow.
      if (Date.now() - startedAt >= CONFIRM_POLL_MAX_MS) {
        setConfirmPhase("timeout");
        return;
      }
      timer = window.setTimeout(tick, CONFIRM_POLL_MS);
    };
    timer = window.setTimeout(tick, CONFIRM_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [confirmPhase, load]);

  const pool = state.kind === "ready" ? state.pool : null;
  const meStatus = pool?.me.status ?? null;

  useEffect(() => {
    if (confirmPhase === "idle" || !isSettledPayment(meStatus)) return;
    setConfirmPhase("idle");
    toast({ variant: "success", title: "Paiement confirmé", description: "Ta place est validée. Merci !" });
    router.replace(pathname, { scroll: false });
  }, [confirmPhase, meStatus, pathname, router, toast]);

  // Live gauge while the pool is open.
  const poolOpen = pool?.status === "open";
  useEffect(() => {
    if (!poolOpen || confirmPhase === "polling") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(refresh, LIVE_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [poolOpen, confirmPhase, load]);

  const phase = pool ? resolvePhase(pool) : null;

  useEffect(() => {
    if (phase === "celebrate") setBurst((n) => n + 1);
  }, [phase]);

  async function post(action: PoolAction) {
    setBusy(action);
    setActionError(null);
    let redirecting = false;
    try {
      const res = await fetch(`/api/billing/pools/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.status === 401) {
        redirecting = true;
        router.replace(`/login?next=${encodeURIComponent(`/dashboard/billing/pool/${code}`)}`);
        return;
      }
      const data = (await res.json().catch(() => null)) as ApiPoolResponse | null;
      if (!res.ok || !data?.success) {
        setActionError(data?.error ?? "Une erreur est survenue. Réessaie dans un instant.");
        void load();
        return;
      }
      if (action === "checkout" && data.checkoutUrl) {
        redirecting = true; // Keep the button busy while the browser leaves.
        window.location.href = data.checkoutUrl;
        return;
      }
      if (action === "join" && data.pool) {
        setState({ kind: "ready", pool: data.pool });
        toast({ variant: "success", title: "Bienvenue dans le groupe !", description: "Ta place est confirmée." });
      }
      if (action === "leave" && data.pool) {
        setState({ kind: "ready", pool: data.pool });
        setConfirmPhase("idle");
        if (data.pool.me.status === "released") {
          toast({ variant: "success", title: "Tu as quitté le groupe", description: "Ta place est libérée et rien n'a été payé." });
        }
      }
    } catch {
      setActionError("Connexion impossible. Vérifie ton réseau et réessaie.");
    } finally {
      if (!redirecting) setBusy(null);
    }
  }

  // Back button from Chargily restores this page from bfcache with `busy` still set.
  useEffect(() => {
    const onShow = () => setBusy(null);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  if (state.kind === "loading") {
    return (
      <CyberStage className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        <div className="h-12 w-64 animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          <div className="h-[26rem] animate-pulse rounded-3xl bg-white/[0.04]" />
          <div className="h-[26rem] animate-pulse rounded-3xl bg-white/[0.04]" />
        </div>
      </CyberStage>
    );
  }

  if (state.kind === "error") {
    const notFound = state.status === 404 || state.status === 400;
    return (
      <CyberStage accent="rose" className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
        <CyberPanel className="p-6 text-center sm:p-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <AlertCircle className="h-6 w-6 text-rose-300" />
          </span>
          <h1 className="mt-4 text-xl font-black text-white">{notFound ? "Lien d'invitation introuvable" : "Impossible d'afficher ce groupe"}</h1>
          <p className="mt-2 text-sm text-slate-400">
            {notFound ? "Vérifie que le lien est complet, ou demande à la personne qui t'a invité(e) de te le renvoyer." : state.message}
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            {!notFound && (
              <Button onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" />
                Réessayer
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/dashboard/billing">Voir les formules</Link>
            </Button>
          </div>
        </CyberPanel>
      </CyberStage>
    );
  }

  const readyPool = state.pool;
  const currentPhase = phase ?? "pay";
  const paidMe = readyPool.me.status === "paid" || readyPool.me.status === "activated";
  const showInvite =
    readyPool.confirmed < readyPool.size &&
    (readyPool.mode === "leader"
      ? // A leader's paid group stays « complete »: its creator hands out the seats until the period ends.
        readyPool.isCreator && readyPool.status === "complete" && (!readyPool.periodEnd || new Date(readyPool.periodEnd).getTime() > Date.now())
      : readyPool.status === "open" && currentPhase !== "refund_pending" && currentPhase !== "refunded");
  const accessEnd = accessEndIso(readyPool);
  const kindLabel = `Groupe · ${readyPool.size} personnes`;
  const showSteps =
    readyPool.mode === "pooled" && (currentPhase === "pay" || currentPhase === "holding" || currentPhase === "paid_waiting" || currentPhase === "celebrate");
  // Only while there is something to pay — never next to « Ne repaie pas » while a payment is being confirmed.
  const creatorMustPay = readyPool.mode === "pooled" && readyPool.isCreator && readyPool.status === "open" && currentPhase === "pay" && !readyPool.me.activePlanEnd;
  const extraRefunds = readyPool.me.extraRefunds ?? [];
  const extraRefundTotal = extraRefunds.reduce((sum, r) => sum + r.amount, 0);
  const extraRefundsSent = extraRefunds.length > 0 && extraRefunds.every((r) => r.status === "refunded");

  return (
    <CyberStage accent={currentPhase === "celebrate" ? "emerald" : "cyan"} className="mx-auto max-w-5xl overflow-x-clip p-4 sm:p-6 lg:p-8">
      <Link href="/dashboard/billing" className="mb-4 inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" />
        Abonnement
      </Link>
      <CyberHeader
        icon={Users}
        kicker={kindLabel}
        title={readyPool.mode === "leader" ? "Ton groupe MedArt AI" : "On débloque MedArt AI ensemble"}
        subtitle={`${readyPool.planLabel} · ${formatDZD(readyPool.pricePerMember)} par personne`}
      />

      {showSteps && <Steps pool={readyPool} paid={paidMe} />}

      <div className="mt-5 space-y-3">
        {creatorMustPay && (
          <Banner tone="cyan" icon={Crown} title="Tu as créé ce groupe : paie ta part pour bloquer ta place">
            Tant que ta part ({formatDZD(readyPool.pricePerMember)}) n&apos;est pas payée, tu ne fais pas partie des {readyPool.size} et un autre ami pourrait
            prendre la dernière place. Paie d&apos;abord, puis partage le lien d&apos;invitation.
            {readyPool.confirmed === 0 && " Un ami a déjà lancé votre groupe ? Utilise plutôt son lien, pour ne pas créer deux groupes."}
          </Banner>
        )}
        {extraRefunds.length > 0 && (
          <Banner tone="amber" icon={Undo2} title="Paiement en double détecté : remboursement automatique">
            {`Tu as payé ta part une fois de trop.${paidMe ? " Ta place reste confirmée." : ""} Le remboursement de ce paiement en trop (${formatDZD(extraRefundTotal)}) `}
            {extraRefundsSent ? "t'a été envoyé." : `a été déclenché automatiquement : tu le reçois sous ${REFUND_DELAY_LABEL}, sans rien faire.`}
          </Banner>
        )}
        {confirmPhase === "polling" && !isSettledPayment(meStatus) && (
          <Banner tone="cyan" icon={Loader2} title="Confirmation de ton paiement…">
            Chargily nous transmet la confirmation : quelques secondes en général, parfois quelques minutes avec Edahabia. Ne repaie pas, cette page se met à
            jour toute seule.
          </Banner>
        )}
        {confirmPhase === "timeout" && !isSettledPayment(meStatus) && (
          <Banner tone="amber" icon={Hourglass} title="La confirmation prend plus de temps que prévu">
            <p>
              Si ton paiement a bien été validé sur Chargily, ta place sera confirmée dès que nous recevons leur notification — inutile de payer une
              seconde fois.
            </p>
            <button
              type="button"
              onClick={() => setConfirmPhase("polling")}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-bold text-amber-200 underline-offset-4 hover:underline"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Vérifier à nouveau
            </button>
          </Banner>
        )}
        {showFailure && !isSettledPayment(meStatus) && (
          <Banner tone="rose" icon={AlertCircle} title="Le paiement n'a pas abouti">
            <p>Pas d&apos;inquiétude, rien n&apos;est validé de ton côté. Tu peux réessayer quand tu veux tant que le groupe n&apos;est pas complet.</p>
            {readyPool.status === "open" && readyPool.mode === "pooled" && (
              <button
                type="button"
                onClick={() => {
                  setShowFailure(false);
                  void post("checkout");
                }}
                className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-bold text-rose-200 underline-offset-4 hover:underline"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Réessayer le paiement
              </button>
            )}
          </Banner>
        )}
        {actionError && (
          <Banner tone="rose" icon={AlertCircle} title="Ce n'est pas possible pour le moment">
            {actionError}
          </Banner>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.05fr_1fr]">
        <CyberPanel laser={readyPool.status === "open" ? "spin" : true} accent={currentPhase === "celebrate" ? "emerald" : "cyan"} className="relative p-5 sm:p-7">
          <Gauge pool={readyPool} phase={currentPhase} />
          <ParticleBurst nonce={burst} color="rgb(52 211 153)" count={18} spread={120} />
        </CyberPanel>

        <div className="space-y-5">
          <CyberPanel className="p-5 sm:p-6">
            <StatePanel
              pool={readyPool}
              phase={currentPhase}
              busy={busy}
              accessEnd={accessEnd}
              onPay={() => void post("checkout")}
              onJoin={() => void post("join")}
              onLeave={() => void post("leave")}
              onRefresh={() => void load()}
            />
          </CyberPanel>

          {readyPool.mode === "pooled" && readyPool.status === "open" && currentPhase !== "refund_pending" && currentPhase !== "refunded" && (
            <CyberPanel className="space-y-4 p-5 sm:p-6">
              <Reassurance pool={readyPool} paid={paidMe} />
              <div className="border-t border-white/[0.07] pt-4">
                <TrustList pool={readyPool} />
              </div>
            </CyberPanel>
          )}
          {readyPool.mode === "leader" && currentPhase === "join" && (
            <CyberPanel className="p-5 sm:p-6">
              <TrustList pool={readyPool} />
            </CyberPanel>
          )}
        </div>
      </div>

      {showInvite && (
        <div className="mt-5">
          <InvitePanel pool={readyPool} />
        </div>
      )}
    </CyberStage>
  );
}

function StatePanel({
  pool,
  phase,
  busy,
  accessEnd,
  onPay,
  onJoin,
  onLeave,
  onRefresh,
}: {
  pool: PoolView;
  phase: Phase;
  busy: PoolAction | null;
  accessEnd: string | null;
  onPay: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onRefresh: () => void;
}) {
  const refund = pool.me.refund;
  const overflow = pool.status === "complete";
  const now = useNow(15000);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!confirmLeave) return;
    const id = window.setTimeout(() => setConfirmLeave(false), 6000);
    return () => window.clearTimeout(id);
  }, [confirmLeave]);

  switch (phase) {
    case "pay": {
      const activePlanEnd = pool.me.activePlanEnd;
      return (
        <div>
          <p className="cyber-kicker">Ta part</p>
          <p className="mt-1 text-3xl font-black tabular-nums text-white">{formatDZD(pool.pricePerMember)}</p>
          <p className="mt-1 text-sm text-slate-400">
            au lieu de <span className="line-through">{formatDZD(soloPrice(pool.cycle))}</span> en individuel · {CYCLE_DURATION[pool.cycle]} d&apos;accès complet
          </p>
          {activePlanEnd ? (
            <>
              <div className="mt-5">
                <Banner tone="amber" icon={CalendarCheck} title={`Tu as déjà un abonnement actif jusqu'au ${formatFrenchDate(activePlanEnd)}`}>
                  Tu n&apos;as rien à payer pour l&apos;instant : tu profites déjà de tout MedArt AI. Tu pourras rejoindre un groupe à la fin de ton abonnement —
                  préviens le créateur pour qu&apos;il invite quelqu&apos;un d&apos;autre à ta place.
                </Banner>
              </div>
              <Button asChild variant="outline" className="mt-4 w-full border-white/15 text-slate-200">
                <Link href="/dashboard/billing">Voir mon abonnement</Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                size="lg"
                onClick={onPay}
                isLoading={busy === "checkout"}
                disabled={busy !== null}
                className="mt-5 h-14 w-full rounded-2xl bg-gradient-to-r from-cyan-300 to-sky-400 text-base font-black text-slate-950 hover:bg-transparent"
              >
                {busy !== "checkout" && <Lock className="h-4 w-4" />}
                Payer ma part : {formatDZD(pool.pricePerMember)}
              </Button>
              <p className="mt-3 text-center text-[11px] text-slate-500">
                Ta place est réservée {HOLD_MINUTES} minutes pendant le paiement · Edahabia / CIB via Chargily Pay
              </p>
            </>
          )}
        </div>
      );
    }

    case "join":
      return (
        <div>
          <p className="cyber-kicker">Invitation</p>
          <p className="mt-1 text-xl font-black text-white">Une place t&apos;attend</p>
          <p className="mt-1 text-sm text-slate-400">
            Le créateur du groupe a déjà payé les {pool.size} places. Il en reste {Math.max(0, pool.size - pool.confirmed)} : rejoins-le, c&apos;est gratuit pour toi.
          </p>
          <Button
            size="lg"
            onClick={onJoin}
            isLoading={busy === "join"}
            className="mt-5 h-14 w-full rounded-2xl bg-gradient-to-r from-emerald-300 to-teal-400 text-base font-black text-slate-950 hover:bg-transparent"
          >
            {busy !== "join" && <UserPlus className="h-5 w-5" />}
            Rejoindre le groupe (place déjà payée)
          </Button>
        </div>
      );

    case "holding": {
      // Right after a checkout is opened, only « Actualiser » is offered: an Edahabia / CIB
      // confirmation can take minutes, and paying a second checkout meanwhile would charge twice.
      const startedAt = pool.me.paymentStartedAt ? new Date(pool.me.paymentStartedAt).getTime() : null;
      const graceEndsAt = startedAt !== null ? startedAt + PAYMENT_CONFIRM_GRACE_MINUTES * 60_000 : null;
      const confirming = graceEndsAt !== null && now < graceEndsAt;
      const minutesLeft = graceEndsAt !== null ? Math.max(1, Math.ceil((graceEndsAt - now) / 60_000)) : 0;
      return (
        <div>
          {confirming ? (
            <>
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                <p className="text-lg font-black text-white">Confirmation de ton paiement…</p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                Si tu as validé le paiement sur Chargily, la confirmation Edahabia / CIB peut prendre quelques minutes.{" "}
                <span className="font-bold text-white">Ne repaie pas</span> : ta place est réservée et cette page se met à jour toute seule.
              </p>
              <Button
                onClick={onRefresh}
                disabled={busy !== null}
                className="mt-4 w-full bg-gradient-to-r from-cyan-300 to-sky-400 font-black text-slate-950 hover:bg-transparent"
              >
                <RefreshCw className="h-4 w-4" />
                Actualiser
              </Button>
              <p className="mt-3 text-center text-[11px] text-slate-500">
                Tu n&apos;as pas terminé le paiement ? Tu pourras le reprendre dans {minutesLeft} min si rien n&apos;arrive.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Hourglass className="h-5 w-5 text-amber-300" />
                <p className="text-lg font-black text-white">Paiement non confirmé</p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                Nous n&apos;avons reçu aucune confirmation de Chargily. Si tu n&apos;as pas terminé le paiement, reprends-le : ton ancienne page de paiement est
                annulée automatiquement, impossible de payer deux fois.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={onPay}
                  isLoading={busy === "checkout"}
                  disabled={busy !== null}
                  className="flex-1 bg-gradient-to-r from-cyan-300 to-sky-400 font-black text-slate-950 hover:bg-transparent"
                >
                  Reprendre le paiement
                </Button>
                <Button variant="outline" onClick={onRefresh} disabled={busy !== null} className="flex-1 border-white/15 text-slate-200">
                  <RefreshCw className="h-4 w-4" />
                  Actualiser
                </Button>
              </div>
            </>
          )}
          {/* Like « Reprendre », leaving cancels the open checkout: never offered while a payment may be confirming. */}
          {!confirming && (
            <div className="mt-4 border-t border-white/[0.07] pt-3">
              <button
                type="button"
                onClick={() => (confirmLeave ? onLeave() : setConfirmLeave(true))}
                disabled={busy !== null}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 text-xs font-bold underline-offset-4 hover:underline disabled:opacity-60",
                  confirmLeave ? "text-rose-200" : "text-slate-400"
                )}
              >
                {busy === "leave" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                {confirmLeave ? "Confirmer : quitter ce groupe et libérer ma place" : "Quitter ce groupe (je n'ai pas payé)"}
              </button>
            </div>
          )}
        </div>
      );
    }

    case "paid_waiting":
      return (
        <div>
          <Banner tone="emerald" icon={ShieldCheck} title="Ta part est payée : ta place est bloquée ✓">
            Prochaine étape : partage le lien d&apos;invitation (juste en dessous) à tes amis. Dès {pool.size}/{pool.size}, MedArt AI s&apos;active automatiquement
            pour tout le monde — tu n&apos;as rien d&apos;autre à faire.
          </Banner>
        </div>
      );

    case "celebrate":
      return (
        <div className="text-center">
          <motion.span
            initial={{ scale: 0.5, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 16 }}
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 to-teal-500 text-slate-950 shadow-[0_0_32px_rgba(52,211,153,0.45)]"
          >
            <PartyPopper className="h-7 w-7" />
          </motion.span>
          <p className="mt-4 text-xl font-black text-white">
            MedArt AI est débloqué pour vous {pool.size}
            {accessEnd ? ` jusqu'au ${formatFrenchDate(accessEnd)}` : ""} !
          </p>
          <p className="mt-2 text-sm text-slate-400">Toutes les fonctionnalités payantes sont actives sur ton compte. Bonnes révisions !</p>
          <Button asChild size="lg" className="mt-5 w-full bg-gradient-to-r from-emerald-300 to-teal-400 font-black text-slate-950 hover:bg-transparent">
            <Link href="/dashboard">
              <CalendarCheck className="h-4 w-4" />
              Commencer à réviser
            </Link>
          </Button>
        </div>
      );

    case "refund_pending":
      return (
        <div>
          <div className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-amber-300" />
            <p className="text-lg font-black text-white">Remboursement déclenché</p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            {overflow
              ? "Ton paiement est arrivé alors que le groupe était déjà complet. "
              : `L'objectif des ${pool.size} n'a pas été atteint dans les ${POOL_DEADLINE_DAYS} jours. `}
            Le remboursement a été déclenché automatiquement : notre équipe t&apos;envoie le montant, tu le reçois sous {REFUND_DELAY_LABEL}. Tu n&apos;as rien à faire.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
              <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Montant</dt>
              <dd className="mt-1 text-lg font-black tabular-nums text-white">{formatDZD(refund?.amount ?? pool.pricePerMember)}</dd>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
              <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Demandé le</dt>
              <dd className="mt-1 text-sm font-bold text-white">{refund ? formatFrenchDate(refund.createdAt) : "En cours"}</dd>
            </div>
          </dl>
        </div>
      );

    case "refunded":
      return (
        <div>
          <Banner tone="emerald" icon={Check} title={refund?.refundedAt ? `Remboursé le ${formatFrenchDate(refund.refundedAt)}` : "Remboursé"}>
            {formatDZD(refund?.amount ?? pool.pricePerMember)} t&apos;ont été renvoyés
            {refund ? ` (demande du ${formatFrenchDate(refund.createdAt)})` : ""}. Tu peux lancer ou rejoindre un nouveau groupe quand tu veux.
          </Banner>
          <Button asChild variant="outline" className="mt-4 w-full border-white/15 text-slate-200">
            <Link href="/dashboard/billing">Voir les formules</Link>
          </Button>
        </div>
      );

    case "expired_outsider":
      return (
        <div>
          <p className="text-lg font-black text-white">Ce groupe est clos</p>
          <p className="mt-2 text-sm text-slate-400">
            L&apos;objectif des {pool.size} n&apos;a pas été atteint à temps. Tu n&apos;as pas été débité(e). Tu peux lancer un nouveau groupe depuis ta page Abonnement.
          </p>
          <Button asChild className="mt-4 w-full">
            <Link href="/dashboard/billing">Lancer un nouveau groupe</Link>
          </Button>
        </div>
      );

    case "full_outsider":
      return (
        <div>
          <p className="text-lg font-black text-white">Ce groupe est déjà complet</p>
          <p className="mt-2 text-sm text-slate-400">Toutes les places ont été prises. Tu peux créer ton propre groupe en quelques secondes.</p>
          <Button asChild className="mt-4 w-full">
            <Link href="/dashboard/billing">Créer mon groupe</Link>
          </Button>
        </div>
      );
  }
}

export default function PoolTrackerPage() {
  return (
    <Suspense fallback={null}>
      <PoolTracker />
    </Suspense>
  );
}
