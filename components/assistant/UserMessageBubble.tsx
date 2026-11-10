"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, Copy, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { tAssistant } from "@/lib/translations/assistant";
import { useLanguage } from "@/providers/LanguageProvider";
import { useToast } from "@/components/ui/Toast";
import { COPILOT_USER_BUBBLE_CLASSES } from "@/components/assistant/CopilotParts";

/** How long "Copié" shows in the menu before it closes on its own. */
const COPIED_HOLD_MS = 900;

const MENU_ITEM =
  "flex min-h-11 w-full cursor-pointer select-none items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium text-white/90 outline-none transition-colors duration-150 data-[highlighted]:bg-white/10 data-[highlighted]:text-white";

/**
 * The student's own message in a Copilot thread (both Copilots). A tap or a
 * click on it — or Enter/Space — opens a small floating menu beside it
 * (product order 2026-11-10, Gemini-style): « Copier le texte », confirmed
 * inline (« Copié »), and « Modifier », which puts the text back in the
 * composer to be edited. Selecting part of the message stays possible: a
 * click that ends a selection doesn't open the menu.
 *
 * The menu is Radix's (focus, arrow keys, Escape, collisions), anchored to an
 * inert layer over the bubble rather than to the bubble itself: Radix's own
 * trigger opens on pointerdown, which would start a menu on every scroll
 * gesture beginning on a message and block text selection with the mouse.
 * Not modal: a tap elsewhere both closes it and does what it does, and the
 * composer can take the focus (and the phone's keyboard) right away for an
 * edit.
 */
export function UserMessageBubble({ text, dir, onEdit }: { text: string; dir?: string; onEdit?: (text: string) => void }) {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  /** Opened from the keyboard: the focus comes back to the bubble when the menu closes. */
  const fromKeyboardRef = useRef(false);
  /** The menu was open when this tap began: the tap closes it, and doesn't reopen it. */
  const wasOpenRef = useRef(false);
  const holdRef = useRef(0);

  useEffect(() => () => window.clearTimeout(holdRef.current), []);

  function setMenuOpen(next: boolean) {
    window.clearTimeout(holdRef.current);
    if (next) setCopied(false);
    setOpen(next);
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (wasOpenRef.current || open) {
      wasOpenRef.current = false;
      setMenuOpen(false);
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) return;
    fromKeyboardRef.current = event.detail === 0;
    haptic();
    setMenuOpen(true);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    fromKeyboardRef.current = true;
    setMenuOpen(true);
  }

  async function handleCopy(event: Event) {
    // Stays open long enough to say it worked.
    event.preventDefault();
    if (copied) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      haptic();
      holdRef.current = window.setTimeout(() => setOpen(false), COPIED_HOLD_MS);
    } catch {
      setMenuOpen(false);
      toast({ variant: "error", title: tAssistant("copyFailed", language), description: tAssistant("copyFailedHint", language) });
    }
  }

  function handleEdit() {
    // The composer takes the focus now, inside this tap, so a phone opens its keyboard.
    fromKeyboardRef.current = false;
    onEdit?.(text);
  }

  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={setMenuOpen} modal={false}>
      <div className="relative max-w-full">
        <DropdownMenuPrimitive.Trigger asChild>
          <span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />
        </DropdownMenuPrimitive.Trigger>
        <div
          ref={bubbleRef}
          role="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-expanded={open}
          dir={dir}
          onPointerDown={() => {
            wasOpenRef.current = open;
          }}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={cn(
            COPILOT_USER_BUBBLE_CLASSES,
            "cursor-pointer select-text outline-none transition-[background-color,box-shadow] duration-200 hover:bg-sky-100/80 focus-visible:ring-2 focus-visible:ring-sky-500/50 aria-expanded:ring-2 aria-expanded:ring-sky-400/40 dark:hover:bg-white/[0.1] dark:focus-visible:ring-white/40 dark:aria-expanded:ring-white/25"
          )}
        >
          {text}
        </div>
      </div>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          hideWhenDetached
          loop
          // Named by its own label: Radix's default aria-labelledby points at the inert anchor, which has no text.
          aria-labelledby={undefined}
          aria-label={tAssistant("messageOptions", language)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (fromKeyboardRef.current) bubbleRef.current?.focus({ preventScroll: true });
          }}
          className="message-menu z-[9999] min-w-[12rem] rounded-2xl border border-white/10 bg-neutral-900/95 p-1.5 text-white shadow-2xl backdrop-blur-md"
        >
          <DropdownMenuPrimitive.Item onSelect={handleCopy} className={MENU_ITEM}>
            {copied ? (
              <Check aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-emerald-400" strokeWidth={2.5} />
            ) : (
              <Copy aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-white/70" strokeWidth={2.25} />
            )}
            <span aria-live="polite">{copied ? tAssistant("messageCopied", language) : tAssistant("copyMessage", language)}</span>
          </DropdownMenuPrimitive.Item>
          {onEdit && (
            <DropdownMenuPrimitive.Item onSelect={handleEdit} className={MENU_ITEM}>
              <Pencil aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-white/70" strokeWidth={2.25} />
              <span>{tAssistant("editMessage", language)}</span>
            </DropdownMenuPrimitive.Item>
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
