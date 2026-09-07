"use client";

/**
 * The "clean opt-in button" — Notification permission is NEVER requested
 * automatically (see lib/push/subscribe.ts's header comment for why); this
 * is the only trigger for it anywhere in the app. Used on both /study and
 * Settings — "settings/study view" per spec, not just one of them.
 */

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { getPushStatus, subscribeToPush, unsubscribeFromPush, type PushSupportStatus } from "@/lib/push/subscribe";

export function PushOptInButton() {
  const { toast } = useToast();
  const [status, setStatus] = useState<PushSupportStatus | "loading">("loading");
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPushStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleClick() {
    setIsWorking(true);
    try {
      if (status === "subscribed") {
        const result = await unsubscribeFromPush();
        if (result.success) {
          setStatus("not-subscribed");
          toast({ variant: "success", title: "Rappels désactivés" });
        } else {
          toast({ variant: "error", title: "Échec de la désactivation", description: result.error });
        }
      } else {
        const result = await subscribeToPush();
        if (result.success) {
          setStatus("subscribed");
          toast({
            variant: "success",
            title: "Rappels activés",
            description: "Tu recevras de temps en temps une notification avec une flashcard de tes modules actifs.",
          });
        } else {
          toast({ variant: "error", title: "Échec de l'activation", description: result.error });
        }
      }
    } finally {
      setIsWorking(false);
    }
  }

  if (status === "loading" || status === "unsupported") return null;

  const isSubscribed = status === "subscribed";
  const isDenied = status === "denied";

  return (
    <Button
      type="button"
      variant={isSubscribed ? "outline" : "primary"}
      onClick={handleClick}
      disabled={isWorking || isDenied}
      title={isDenied ? "Notifications bloquées dans les réglages du navigateur pour ce site." : undefined}
    >
      {isWorking ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isSubscribed ? (
        <BellOff className="h-4 w-4" />
      ) : (
        <Bell className="h-4 w-4" />
      )}
      {isDenied ? "Notifications bloquées" : isSubscribed ? "Désactiver les rappels flash" : "Activer les rappels flash"}
    </Button>
  );
}
