"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (input: { variant?: ToastVariant; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { icon: typeof CheckCircle2; accent: string }> = {
  success: { icon: CheckCircle2, accent: "border-emerald-500/40 text-emerald-400" },
  error: { icon: AlertTriangle, accent: "border-rose-500/40 text-rose-400" },
  info: { icon: Info, accent: "border-cyan-500/40 text-cyan-400" },
};

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    ({ variant = "info", title, description }) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, variant, title, description }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-full max-w-sm flex-col gap-2">
        <AnimatePresence>
          {toasts.map((item) => {
            const { icon: Icon, accent } = VARIANT_STYLES[item.variant];
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.18 }}
                className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-slate-900/95 p-3.5 shadow-xl backdrop-blur ${accent}`}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-100">{item.title}</p>
                  {item.description && <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{item.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
                  aria-label="Fermer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast doit être utilisé à l'intérieur de <ToastProvider>.");
  }
  return ctx;
}
