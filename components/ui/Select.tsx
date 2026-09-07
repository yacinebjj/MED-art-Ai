"use client";

import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";

const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={6}
      className={cn(
        "relative z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-2xl border border-border/60 bg-popover/95 text-popover-foreground shadow-glass backdrop-blur-xl dark:shadow-glass-dark",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="scrollbar-thin p-1">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm outline-none transition-all duration-150",
      "focus:bg-accent focus:text-accent-foreground hover:translate-x-0.5 active:scale-[0.98] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[disabled]:hover:translate-x-0",
      className
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-primary" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

interface SelectOption {
  value: string;
  label: string;
  /** Locks this one option (e.g. an "Interne" year not yet open to students) without disabling the whole field. */
  disabled?: boolean;
}

interface SelectProps {
  label?: string;
  error?: string;
  options: readonly SelectOption[];
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /**
   * Fires when the student clicks an option with `disabled: true`. Radix
   * marks a disabled Item `pointer-events: none` (see SelectItem's own
   * `data-[disabled]:pointer-events-none` below), which means the item
   * itself can never receive the click — the click instead hit-tests
   * through to whatever's directly behind it, which in this layout is
   * always the wrapping `<div>` rendered around exactly that option below.
   * That wrapper's `onClick` is this callback — the standard way to surface
   * "why is this locked?" feedback (e.g. a toast) for a genuinely
   * unselectable Radix item.
   */
  onDisabledOptionClick?: (option: SelectOption) => void;
}

export function Select({
  label,
  error,
  options,
  placeholder,
  value,
  defaultValue,
  onValueChange,
  name,
  required,
  disabled,
  id,
  className,
  onDisabledOptionClick,
}: SelectProps) {
  const selectId = id ?? name;

  return (
    <div className="w-full">
      {label && <Label htmlFor={selectId}>{label}</Label>}
      <SelectPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        name={name}
        required={required}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          id={selectId}
          className={cn(
            "group flex w-full items-center justify-between rounded-xl border bg-card px-3.5 py-2.5 text-sm text-foreground shadow-soft transition-all duration-300",
            "hover:border-primary/40",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary",
            "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-input disabled:bg-muted/40",
            "data-[placeholder]:text-muted-foreground",
            error ? "border-destructive hover:border-destructive" : "border-input",
            className
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-300 group-data-[state=open]:rotate-180" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectContent>
          {options.map((option) =>
            option.disabled ? (
              <div key={option.value} onClick={() => onDisabledOptionClick?.(option)}>
                <SelectItem value={option.value} disabled>
                  {option.label}
                </SelectItem>
              </div>
            ) : (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            )
          )}
        </SelectContent>
      </SelectPrimitive.Root>
      {error && <p className="mt-1.5 animate-in fade-in-0 slide-in-from-top-1 text-xs text-destructive duration-200">{error}</p>}
    </div>
  );
}
