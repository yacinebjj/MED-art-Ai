export function DayDivider({ label }: { label: string }) {
  return (
    // sticky, not just centered — the whole point of a date divider in a
    // long scrolling thread is that it stays pinned to the top of the feed
    // while you scroll through that day's messages, the same behavior
    // Telegram/WhatsApp use. z-20 keeps it above message bubbles as they
    // scroll underneath it.
    <div className="sticky top-1 z-20 my-2 flex justify-center">
      <span className="rounded-full border border-zinc-200 bg-white/90 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-zinc-900/80 dark:text-zinc-300 dark:shadow-lg dark:shadow-black/20">
        {label}
      </span>
    </div>
  );
}
