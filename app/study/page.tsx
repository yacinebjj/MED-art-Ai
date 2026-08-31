import { redirect } from "next/navigation";

/**
 * /study moved into the (shell) route group as /dashboard/study — outside
 * that group, this page never rendered Sidebar/Topbar/MobileBottomNav at
 * all (a different route tree, not a JSX condition hiding them). This
 * stub keeps old bookmarks/links alive, including the push-notification
 * deep link in public/sw.js (`/study?tab=flashcards&cardId=...`) — the
 * query string is forwarded as-is so that link keeps landing on the right
 * tab/card instead of just bouncing to a bare /dashboard/study.
 */
export default function StudyRedirectPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      params.set(key, value);
    } else if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    }
  }
  const query = params.toString();
  redirect(query ? `/dashboard/study?${query}` : "/dashboard/study");
}
