import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { STUDY_GROUPS_ENABLED } from "@/lib/features";

/** Study groups are switched off (lib/features.ts) — old links and invite URLs land on the dashboard instead. */
export default function GroupsLayout({ children }: { children: ReactNode }) {
  if (!STUDY_GROUPS_ENABLED) redirect("/dashboard");
  return children;
}
