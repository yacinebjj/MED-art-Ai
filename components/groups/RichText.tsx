"use client";

import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { MENTION_PATTERN } from "@/lib/group-chat-envelope";

const MENTION_SCHEME = "mention:";

/** "@[Name](uuid)" → a Markdown link with a private scheme, rendered as a mention chip below. */
function withMentionLinks(text: string): string {
  return text.replace(MENTION_PATTERN, (_match, name: string, id: string) => `[@${name.replace(/[[\]]/g, "")}](${MENTION_SCHEME}${id})`);
}

/** Keep our mention scheme; everything else goes through react-markdown's safe default (javascript: etc. stripped). */
function urlTransform(url: string): string {
  return url.startsWith(MENTION_SCHEME) ? url : defaultUrlTransform(url);
}

/**
 * Group-chat message text: GitHub-flavoured Markdown (bold, italic, lists,
 * tables, `code` and fenced code blocks for algorithms), @mention chips, safe
 * links. Raw HTML is never rendered (react-markdown's default), images from
 * Markdown become plain links (no third-party image loads from a message).
 */
export const RichText = memo(function RichText({ text, onColoredBubble, currentUserId }: { text: string; onColoredBubble: boolean; currentUserId: string | null }) {
  const components: Components = {
    p: ({ children }) => <p className="whitespace-pre-wrap break-words [&:not(:first-child)]:mt-1.5">{children}</p>,
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="opacity-70">{children}</del>,
    ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className={cn("my-1 border-l-2 pl-2.5 italic", onColoredBubble ? "border-white/60 text-white/90" : "border-cyan-500/60 text-zinc-600 dark:text-zinc-300")}>{children}</blockquote>
    ),
    h1: ({ children }) => <p className="mt-1 text-base font-extrabold">{children}</p>,
    h2: ({ children }) => <p className="mt-1 text-[15px] font-bold">{children}</p>,
    h3: ({ children }) => <p className="mt-1 font-bold">{children}</p>,
    hr: () => <hr className={cn("my-2", onColoredBubble ? "border-white/30" : "border-zinc-300 dark:border-white/10")} />,
    code: ({ className, children }) => {
      const isBlock = /language-/.test(className ?? "") || String(children).includes("\n");
      if (isBlock) {
        return (
          <code className={cn("block whitespace-pre overflow-x-auto rounded-lg px-3 py-2 font-mono text-[12.5px] leading-relaxed", onColoredBubble ? "bg-black/25 text-white" : "bg-zinc-900 text-emerald-200 dark:bg-black/50")}>
            {children}
          </code>
        );
      }
      return <code className={cn("rounded px-1 py-0.5 font-mono text-[13px]", onColoredBubble ? "bg-black/20" : "bg-zinc-200 text-rose-700 dark:bg-white/10 dark:text-rose-300")}>{children}</code>;
    },
    pre: ({ children }) => <pre className="my-1.5 max-w-full">{children}</pre>,
    table: ({ children }) => (
      <div className="my-1.5 max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className={cn("border px-2 py-1 text-left font-semibold", onColoredBubble ? "border-white/30" : "border-zinc-300 dark:border-white/10")}>{children}</th>,
    td: ({ children }) => <td className={cn("border px-2 py-1 align-top", onColoredBubble ? "border-white/30" : "border-zinc-300 dark:border-white/10")}>{children}</td>,
    img: ({ src, alt }) => (
      <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {alt || "image"}
      </a>
    ),
    a: ({ href, children }) => {
      if (href?.startsWith(MENTION_SCHEME)) {
        const isMe = currentUserId !== null && href.slice(MENTION_SCHEME.length).toLowerCase() === currentUserId.toLowerCase();
        return (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1 font-semibold",
              isMe
                ? "bg-amber-300/90 text-amber-950"
                : onColoredBubble
                  ? "bg-white/20 text-white"
                  : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
            )}
          >
            <AtSign className="h-3 w-3" />
            {String(children).replace(/^@/, "")}
          </span>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-medium underline underline-offset-2">
          {children}
        </a>
      );
    },
  };

  return (
    <div className="text-[15px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {withMentionLinks(text)}
      </ReactMarkdown>
    </div>
  );
});
