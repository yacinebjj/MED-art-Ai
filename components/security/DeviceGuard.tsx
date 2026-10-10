"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Laptop, Loader2, LogOut, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/providers/AuthProvider";

/** Fired by the global fetch wrapper (components/billing/PaywallProvider.tsx) on any same-origin 401. */
export const AUTH_REJECTED_EVENT = "medart:auth-rejected";

/** A burst of 401s (every startup call of a blocked device) triggers one check, not ten. */
const RECHECK_THROTTLE_MS = 10_000;

interface DeviceRow {
  id: string;
  label: string | null;
  lastSeenAt: string;
  current: boolean;
}

interface DeviceState {
  status: "ok" | "limit";
  max: number;
  cooldownHours: number;
  devices: DeviceRow[];
}

function formatLastSeen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function isPhone(label: string | null): boolean {
  return /iPhone|Android|iPad/.test(label ?? "");
}

/**
 * 2-device limit screen (lib/devices.ts). Checks this device once the user
 * is known, and again whenever an API call is rejected with 401. While the
 * account already has its maximum of OTHER devices, it covers the app with
 * the list of those devices: replace one of them, or sign out.
 */
export function DeviceGuard() {
  const { user, signOut } = useAuth();
  const [state, setState] = useState<DeviceState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastCheckRef = useRef(0);

  const check = useCallback(async () => {
    lastCheckRef.current = Date.now();
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) return;
      setState((await res.json()) as DeviceState);
    } catch {
      // Network hiccup: keep whatever was shown; the next 401 re-checks.
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setState(null);
      return;
    }
    void check();
    function handleRejected() {
      if (Date.now() - lastCheckRef.current > RECHECK_THROTTLE_MS) void check();
    }
    window.addEventListener(AUTH_REJECTED_EVENT, handleRejected);
    return () => window.removeEventListener(AUTH_REJECTED_EVENT, handleRejected);
  }, [user?.id, check]);

  async function replace(deviceId: string) {
    setBusyId(deviceId);
    setError(null);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replace", deviceId }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        setError(body.error ?? "Impossible de remplacer l'appareil pour le moment.");
        return;
      }
      // Every request this device made while blocked failed: start clean.
      window.location.reload();
    } catch {
      setError("Erreur réseau. Vérifie ta connexion puis réessaie.");
    } finally {
      setBusyId(null);
    }
  }

  if (!user || state?.status !== "limit") return null;

  const others = state.devices.filter((device) => !device.current);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="device-limit-title" className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-background p-5 shadow-2xl sm:p-6">
        <h2 id="device-limit-title" className="text-lg font-bold text-foreground">
          Limite de {state.max} appareils atteinte
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ton compte MedArt est déjà utilisé sur {state.max} appareils. Pour continuer ici, remplace l&apos;un d&apos;eux — il sera déconnecté. Tu peux
          remplacer un appareil une fois toutes les {state.cooldownHours} h.
        </p>

        <ul className="mt-4 space-y-2">
          {others.map((device) => {
            const Icon = isPhone(device.label) ? Smartphone : Laptop;
            return (
              <li key={device.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{device.label ?? "Appareil"}</p>
                  <p className="text-xs text-muted-foreground">Dernière activité : {formatLastSeen(device.lastSeenAt)}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => replace(device.id)}>
                  {busyId === device.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remplacer"}
                </Button>
              </li>
            );
          })}
        </ul>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <Button variant="ghost" className="mt-4 w-full" onClick={() => void signOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Se déconnecter
        </Button>
      </div>
    </div>
  );
}
