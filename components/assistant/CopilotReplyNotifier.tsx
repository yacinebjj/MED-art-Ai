"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAssistant } from "@/lib/translations/assistant";
import { REPLY_READY_EVENT } from "@/lib/copilot-reply-runner";

/**
 * A Copilot answer that finished while the student was elsewhere in MedArt
 * (lib/copilot-reply-runner.ts keeps it running after the Copilot page is
 * left): a toast says it is ready, with a shortcut back to it. Mounted once
 * for every /dashboard page (app/dashboard/layout.tsx).
 */
export function CopilotReplyNotifier() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { language } = useLanguage();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    function handleReady() {
      // Back on the Copilot already: the answer is in front of them.
      if (pathnameRef.current === "/dashboard/assistant") return;
      toast({
        variant: "success",
        title: tAssistant("replyReadyTitle", language),
        description: tAssistant("replyReadyBody", language),
        action: { label: tAssistant("replyReadyOpen", language), onClick: () => router.push("/dashboard/assistant") },
      });
    }
    window.addEventListener(REPLY_READY_EVENT, handleReady);
    return () => window.removeEventListener(REPLY_READY_EVENT, handleReady);
  }, [toast, router, language]);

  return null;
}
