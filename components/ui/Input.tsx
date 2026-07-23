import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id ?? props.name;

    return (
      <div className="w-full">
        {label && <Label htmlFor={inputId}>{label}</Label>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full rounded-xl border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground shadow-soft transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary",
            error ? "border-destructive" : "border-input",
            className
          )}
          {...props}
        />
        {error ? (
          <p className="mt-1.5 text-xs text-destructive">{error}</p>
        ) : hint ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";
