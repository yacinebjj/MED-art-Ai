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
  duration: number;
}

interface ToastContextValue {
  toast: (input: { variant?: ToastVariant; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Error toasts linger noticeably longer than success/info: a mistake message
// that vanishes in the blink of an eye reads as more alarming ("wait, what
// just happened?") than one the student has real time to read and dismiss
// on their own terms — reassuring, not urgent.
const VARIANT_CONFIG: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; border: string; iconClass: string; barClass: string; duration: number }
> = {
  success: {
    icon: CheckCircle2,
    border: "border-emerald-500/30",
    iconClass: "text-emerald-600 dark:text-emerald-400",
    barClass: "bg-emerald-500",
    duration: 5000,
  },
  error: {
    icon: AlertTriangle,
    border: "border-destructive/30",
    iconClass: "text-destructive",
    barClass: "bg-destructive",
    duration: 9000,
  },
  info: {
    icon: Info,
    border: "border-cyan-500/30",
    iconClass: "text-cyan-600 dark:text-cyan-400",
    barClass: "bg-cyan-500",
    duration: 6000,
  },
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
      const duration = VARIANT_CONFIG[variant].duration;
      setToasts((current) => [...current, { id, variant, title, description, duration }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live="polite" (never "assertive") even for errors — a screen
          reader interruption mid-sentence is its own small jolt, and staying
          calm here matters just as much for that audience. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-full max-w-sm flex-col gap-2"
      >
        <AnimatePresence>
          {toasts.map((item) => {
            const { icon: Icon, border, iconClass, barClass, duration } = VARIANT_CONFIG[item.variant];
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={`glass-panel pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border p-3.5 shadow-glass dark:shadow-glass-dark ${border}`}
              >
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  {item.description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Fermer la notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {/* Quiet countdown sliver, not a numeric timer — lets a
                    glance confirm the toast is about to clear on its own
                    (not stuck/broken) without demanding attention. */}
                <motion.span
                  aria-hidden
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: duration / 1000, ease: "linear" }}
                  className={`absolute inset-x-0 bottom-0 h-0.5 origin-left opacity-40 ${barClass}`}
                />
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
