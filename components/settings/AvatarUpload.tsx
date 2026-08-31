"use client";

import { ChangeEvent, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Written out in full (not built as `h-${size} w-${size}`) so Tailwind's
// static class scan — which never evaluates template strings — actually
// picks these up. Icon sizes scale down a step with the avatar so the
// overlay/fallback initial keep looking proportional at every call site.
const SIZE_CLASSES: Record<12 | 16 | 20, { box: string; icon: string; text: string }> = {
  12: { box: "h-12 w-12", icon: "h-4 w-4", text: "text-base" },
  16: { box: "h-16 w-16", icon: "h-5 w-5", text: "text-xl" },
  20: { box: "h-20 w-20", icon: "h-6 w-6", text: "text-2xl" },
};

/**
 * Click-to-change profile photo — just the clickable avatar itself (no
 * caption/label around it), so it drops in as-is anywhere a photo needs to
 * be editable: Settings today, and later Sidebar/Topbar (a following agent's
 * phase — this component is written with that reuse in mind, which is also
 * why it carries no Settings-specific copy of its own; the calling page
 * supplies any surrounding text, same convention as PushOptInButton below).
 *
 * Mirrors ChatRoom.tsx's uploadMedia pattern (hidden file input -> FormData
 * -> fetch -> toast on failure) but targets POST /api/profile/avatar, then
 * calls AuthProvider's refreshAvatarUrl() so the new photo shows up
 * immediately everywhere `profile.avatarUrl` is read.
 *
 * Client-side checks below are just for instant feedback (wrong-format/
 * too-big toasts without a round trip) — the server route re-validates both
 * independently and is the actual source of truth.
 */
export function AvatarUpload({ className, size = 16 }: { className?: string; size?: 12 | 16 | 20 }) {
  const { profile, refreshAvatarUrl } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";
  const sizeClasses = SIZE_CLASSES[size];

  function handlePick() {
    if (isUploading) return;
    inputRef.current?.click();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the exact same file again still fires onChange
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({
        variant: "error",
        title: "Format d'image non supporté.",
        description: "Utilise une image JPG, PNG, WEBP ou GIF.",
      });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast({
        variant: "error",
        title: "Image trop volumineuse.",
        description: `${(file.size / (1024 * 1024)).toFixed(1)} Mo — le maximum est ${MAX_AVATAR_BYTES / (1024 * 1024)} Mo.`,
      });
      return;
    }

    setIsUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/profile/avatar", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "L'envoi de la photo a échoué.");
      await refreshAvatarUrl();
      toast({ variant: "success", title: "Photo de profil mise à jour." });
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "L'envoi de la photo a échoué." });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handlePick}
      disabled={isUploading}
      aria-label="Changer la photo de profil"
      className={cn(
        "group relative shrink-0 rounded-full transition-all duration-300",
        sizeClasses.box,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed active:scale-[0.96]",
        className
      )}
    >
      <Avatar className={cn(sizeClasses.box, "border-2 border-border shadow-glass dark:shadow-glass-dark")}>
        {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
        <AvatarFallback className={sizeClasses.text}>{initial}</AvatarFallback>
      </Avatar>

      <span
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity duration-300",
          "group-hover:opacity-100 group-focus-visible:opacity-100",
          isUploading && "opacity-100"
        )}
      >
        {isUploading ? <Loader2 className={cn(sizeClasses.icon, "animate-spin")} /> : <Camera className={sizeClasses.icon} />}
      </span>

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </button>
  );
}
