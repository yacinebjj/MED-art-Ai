"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PaywallReason } from "@/lib/subscription";
import { useAuth } from "@/providers/AuthProvider";
import { notifyUsageChanged, useUsage } from "@/hooks/useUsage";
import { PaywallModal, type PaywallView } from "@/components/billing/PaywallModal";
import { QUOTA_CHECK_FAILED_MESSAGE } from "@/lib/quota-messages";
import { AUTH_REJECTED_EVENT } from "@/components/security/DeviceGuard";

/** Mirrors PAYWALL_HEADER in lib/quota-response.ts (server-only module, not importable here). */
const PAYWALL_HEADER = "x-medart-paywall";
const PAYWALL_EVENT = "medart:paywall";
const BILLING_ROUTE = "/dashboard/billing";

const PAYWALL_REASONS: readonly PaywallReason[] = [
  "trial_courses",
  "trial_messages",
  "trial_feature",
  "quota_courses",
  "quota_exams",
  "quota_syntheses",
  "quota_audio_daily",
  "quota_audio_monthly",
];

function isPaywallReason(value: string | null): value is PaywallReason {
  return value !== null && (PAYWALL_REASONS as readonly string[]).includes(value);
}

declare global {
  interface Window {
    __medartPaywallFetchInstalled?: boolean;
  }
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

const QUOTA_RETRY_DELAYS_MS = [600, 1500];

/** A request is replayable when its body can be sent again as-is (not a one-shot stream). */
function isReplayable(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (input instanceof Request && input.body !== null) return false;
  const body = init?.body;
  return body === undefined || body === null || typeof body === "string" || body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob;
}

/**
 * True when a quota gate answered "could not verify" (lib/subscription.ts's
 * CHECK_FAILED): the database was briefly unreachable and nothing was
 * reserved, so replaying the same request is safe. Only small JSON error
 * responses are inspected, on a clone — the caller still gets an unread body.
 */
async function isQuotaCheckFailure(response: Response): Promise<boolean> {
  if (response.ok || response.status < 403 || !(response.headers.get("content-type") ?? "").includes("application/json")) return false;
  try {
    const data = (await response.clone().json()) as { error?: unknown } | null;
    return data?.error === QUOTA_CHECK_FAILED_MESSAGE;
  } catch {
    return false;
  }
}

/**
 * One global fetch wrapper for the whole app:
 *  - any same-origin response carrying the paywall header opens the paywall
 *    (only headers are read for that);
 *  - a transient "Impossible de vérifier ton quota" answer is replayed
 *    silently, up to twice, instead of reaching the student — what their
 *    manual "Réessayer" used to do, without them seeing an error first.
 * Guarded so React re-mounts / Fast Refresh never wrap it twice.
 */
function installPaywallFetch() {
  if (typeof window === "undefined" || window.__medartPaywallFetchInstalled) return;
  window.__medartPaywallFetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let response = await originalFetch(input, init);
    if (isSameOrigin(input) && isReplayable(input, init)) {
      for (const delayMs of QUOTA_RETRY_DELAYS_MS) {
        if (init?.signal?.aborted || !(await isQuotaCheckFailure(response))) break;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (init?.signal?.aborted) break;
        response = await originalFetch(input, init);
      }
    }
    // A 401 can mean "this device is over the 2-device limit": DeviceGuard
    // re-checks (throttled on its side) and shows the device screen if so.
    if (response.status === 401 && isSameOrigin(input)) window.dispatchEvent(new Event(AUTH_REJECTED_EVENT));
    try {
      const reason = response.headers.get(PAYWALL_HEADER);
      if (reason && isPaywallReason(reason) && isSameOrigin(input)) {
        window.dispatchEvent(new CustomEvent<PaywallReason>(PAYWALL_EVENT, { detail: reason }));
        notifyUsageChanged();
      }
    } catch {
      // Never let paywall detection break a request.
    }
    return response;
  };
}

function isBillingRoute(pathname: string | null): boolean {
  return pathname === BILLING_ROUTE || (pathname?.startsWith(`${BILLING_ROUTE}/`) ?? false);
}

interface PaywallContextValue {
  /** Opens the paywall / limit screen without a server round-trip (e.g. a trial user clicking a paid feature). */
  openPaywall: (reason: PaywallReason) => void;
}

const PaywallContext = createContext<PaywallContextValue>({ openPaywall: () => undefined });

export function usePaywall(): PaywallContextValue {
  return useContext(PaywallContext);
}

/** Mounted once in app/dashboard/layout.tsx. */
export function PaywallProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { usage } = useUsage();
  const [reason, setReason] = useState<PaywallReason | null>(null);

  useEffect(() => {
    installPaywallFetch();
    function handlePaywall(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === "string" && isPaywallReason(detail)) setReason(detail);
    }
    window.addEventListener(PAYWALL_EVENT, handlePaywall);
    return () => window.removeEventListener(PAYWALL_EVENT, handlePaywall);
  }, []);

  // A different account (sign-in / sign-out) → fresh usage.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = user?.id ?? null;
    if (lastUserIdRef.current !== undefined && lastUserIdRef.current !== id) notifyUsageChanged();
    lastUserIdRef.current = id;
  }, [user?.id]);

  // A paid plan just activated (e.g. back from checkout): a stale trial paywall goes away.
  useEffect(() => {
    if (usage && !usage.isTrial) setReason((current) => (current && current.startsWith("trial_") ? null : current));
  }, [usage]);

  const onBilling = isBillingRoute(pathname);
  const locked = Boolean(user && usage?.trialExhausted) && !onBilling;

  // The billing page is where the student pays: nothing may cover it.
  useEffect(() => {
    if (onBilling) setReason(null);
  }, [onBilling]);

  const view: PaywallView | null = onBilling ? null : locked ? "trial_exhausted" : reason;

  const openPaywall = useCallback((next: PaywallReason) => setReason(next), []);
  const contextValue = useMemo(() => ({ openPaywall }), [openPaywall]);

  const handleChoosePlan = useCallback(() => {
    setReason(null);
    router.push(BILLING_ROUTE);
  }, [router]);

  const handleBackToCourse = useCallback(() => {
    setReason(null);
    if (pathname !== "/dashboard") router.push("/dashboard");
  }, [pathname, router]);

  const handleClose = useCallback(() => setReason(null), []);

  return (
    <PaywallContext.Provider value={contextValue}>
      {children}
      <PaywallModal view={view} usage={usage} locked={locked} onChoosePlan={handleChoosePlan} onBackToCourse={handleBackToCourse} onClose={handleClose} />
    </PaywallContext.Provider>
  );
}
