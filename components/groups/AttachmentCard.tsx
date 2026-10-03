"use client";

import { Download, FileSpreadsheet, FileText, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatAttachment } from "@/lib/group-chat-envelope";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function kindOf(mime: string, name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return { label: "PDF", icon: FileText, tint: "from-rose-500 to-red-600" };
  if (/presentation|powerpoint/.test(mime) || ext === "ppt" || ext === "pptx") return { label: "PowerPoint", icon: Presentation, tint: "from-orange-500 to-amber-600" };
  if (/spreadsheet|excel/.test(mime) || ext === "xls" || ext === "xlsx") return { label: "Excel", icon: FileSpreadsheet, tint: "from-emerald-500 to-green-600" };
  if (/word/.test(mime) || ext === "doc" || ext === "docx") return { label: "Word", icon: FileText, tint: "from-blue-500 to-indigo-600" };
  return { label: "Document", icon: FileText, tint: "from-zinc-500 to-zinc-700" };
}

/** A shared course document (PDF, Word, PowerPoint, Excel, text): opens in a new tab, downloadable. */
export function AttachmentCard({ attachment, onColoredBubble = false, compact = false }: { attachment: ChatAttachment; onColoredBubble?: boolean; compact?: boolean }) {
  const kind = kindOf(attachment.mime, attachment.name);
  const Icon = kind.icon;
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group/doc flex min-w-0 items-center gap-3 rounded-xl border p-2.5 transition-all duration-200 hover:-translate-y-0.5",
        compact ? "w-full" : "w-[min(17rem,70vw)]",
        onColoredBubble
          ? "border-white/25 bg-white/15 text-white hover:bg-white/25"
          : "border-zinc-200 bg-white text-zinc-900 hover:border-cyan-300 hover:shadow-md dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:border-cyan-800"
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-md", kind.tint)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{attachment.name}</span>
        <span className={cn("block text-[11px]", onColoredBubble ? "text-white/75" : "text-zinc-500 dark:text-zinc-400")}>
          {kind.label}
          {attachment.size > 0 ? ` · ${formatSize(attachment.size)}` : ""}
        </span>
      </span>
      <Download className={cn("h-4 w-4 shrink-0 transition-transform group-hover/doc:translate-y-0.5", onColoredBubble ? "text-white/80" : "text-zinc-400")} />
    </a>
  );
}
