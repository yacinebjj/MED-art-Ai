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
        "relative z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-card",
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
      "relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm outline-none transition-colors",
      "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
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
            "flex w-full items-center justify-between rounded-xl border bg-card px-3.5 py-2.5 text-sm text-foreground shadow-soft transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "data-[placeholder]:text-muted-foreground",
            error ? "border-destructive" : "border-input",
            className
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
