"use client";

import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "placeholder"> {
  label: string;
  icon?: ReactNode;
  /** Right-side control (e.g. the show-password toggle). */
  trailing?: ReactNode;
  /** Shown under the field while focused (e.g. "8 caractères minimum"). */
  hint?: string;
}

/**
 * Floating-label field for the auth card. The label rests inside the field
 * and floats up on focus or when filled; a cyan→violet gradient border draws
 * in on focus. Pure CSS transitions (transform / opacity) — no JS animation
 * per keystroke, nothing that re-renders on input beyond the parent's value.
 */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { label, icon, trailing, hint, className, id, onFocus, onBlur, ...props },
  ref
) {
  const autoId = useId();
  const inputId = id ?? props.name ?? autoId;
  const [focused, setFocused] = useState(false);

  return (
    <div className="w-full">
      <div className="group relative rounded-2xl">
        {/* Focus ring: gradient border drawn by scaling a 1.5px gradient frame. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-400 to-violet-500 opacity-0 transition-opacity duration-300",
            focused && "opacity-100"
          )}
        />
        <div className="relative flex items-center rounded-2xl border border-white/10 bg-slate-900/80 transition-colors duration-300 group-hover:border-white/20">
          {icon && (
            <span className={cn("pointer-events-none pl-4 transition-colors duration-300", focused ? "text-cyan-300" : "text-slate-500")}>{icon}</span>
          )}
          <div className="relative min-w-0 flex-1">
            <input
              ref={ref}
              id={inputId}
              placeholder=" "
              onFocus={(e) => {
                setFocused(true);
                onFocus?.(e);
              }}
              onBlur={(e) => {
                setFocused(false);
                onBlur?.(e);
              }}
              className={cn(
                "peer block h-14 w-full bg-transparent px-4 pb-1.5 pt-5 text-base text-white outline-none placeholder:text-transparent sm:text-[15px]",
                // Browser autofill: keep the dark field (no pale yellow box) and white text.
                "autofill:shadow-[inset_0_0_0_1000px_rgb(15_23_42)] [&:-webkit-autofill]:[-webkit-text-fill-color:#fff]",
                icon && "pl-3",
                className
              )}
              {...props}
            />
            <label
              htmlFor={inputId}
              className={cn(
                "pointer-events-none absolute left-4 top-1/2 origin-left -translate-y-1/2 text-[15px] text-slate-400 transition-all duration-200",
                icon && "left-3",
                "peer-focus:top-3.5 peer-focus:translate-y-0 peer-focus:scale-[0.78] peer-focus:text-cyan-300",
                "peer-[:not(:placeholder-shown)]:top-3.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:scale-[0.78]"
              )}
            >
              {label}
            </label>
          </div>
          {trailing && <span className="pr-3">{trailing}</span>}
        </div>
      </div>
      {hint && <p className={cn("mt-1.5 px-1 text-xs text-slate-500 transition-opacity duration-200", focused ? "opacity-100" : "opacity-0")}>{hint}</p>}
    </div>
  );
});
