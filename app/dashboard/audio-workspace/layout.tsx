import { redirect } from "next/navigation";
import { AUDIO_SMART_NOTES_ENABLED } from "@/lib/feature-flags";

/**
 * "Audio to Smart Notes" is held back for V2 (lib/feature-flags.ts). The page
 * and its components stay untouched; this server layout is the second gate
 * behind middleware, so the route can never render while the flag is off.
 */
export default function AudioWorkspaceLayout({ children }: { children: React.ReactNode }) {
  if (!AUDIO_SMART_NOTES_ENABLED) redirect("/dashboard");
  return children;
}
