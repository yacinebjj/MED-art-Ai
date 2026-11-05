import { waitUntil } from "@vercel/functions";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { dispatchPushToUser } from "@/lib/push/dispatch";
import { sanitizeForPostgres } from "@/lib/course-generation-shared";
import { AWAY_NS, REPLY_NS, outliveClient, type ReplyDocument } from "@/lib/copilot-background";

/**
 * The real hooks behind lib/copilot-background.ts: the reply is kept in the
 * student's sync store (user_sync_documents — the table the conversations
 * already sync through, so no new migration), and a student who is away gets
 * a push on every device they subscribed (lib/push/dispatch.ts).
 */

/** A reply is only worth collecting for a short while; older ones are tidied away. */
const KEEP_MS = 2 * 24 * 60 * 60 * 1000;

async function writeReply(userId: string, replyId: string, data: ReplyDocument): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("user_sync_documents")
    .upsert(
      { user_id: userId, namespace: REPLY_NS, doc_key: replyId, data, deleted: false, updated_at: new Date().toISOString() },
      { onConflict: "user_id,namespace,doc_key" }
    );
  if (error) console.error("[copilot-background] Réponse non enregistrée:", { code: error.code, message: error.message });
}

async function readAway(userId: string, replyId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_sync_documents")
    .select("data")
    .eq("user_id", userId)
    .eq("namespace", AWAY_NS)
    .eq("doc_key", replyId)
    .maybeSingle<{ data: { away?: unknown } | null }>();
  return !error && data?.data?.away === true;
}

async function pruneOldReplies(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - KEEP_MS).toISOString();
  await getSupabaseAdmin().from("user_sync_documents").delete().eq("user_id", userId).in("namespace", [REPLY_NS, AWAY_NS]).lt("updated_at", cutoff);
}

/** `source`, delivered to the student and carried on to its end in the background (see lib/copilot-background.ts). */
export function streamReplyInBackground(
  source: ReadableStream<Uint8Array>,
  { userId, replyId, language }: { userId: string; replyId: string; language: "fr" | "en" }
): ReadableStream<Uint8Array> {
  if (!isSupabaseConfigured()) return source;
  const startedAt = Date.now();
  return outliveClient(source, {
    onStart: async () => {
      await writeReply(userId, replyId, { status: "generating", content: "", startedAt });
      // About one request in ten tidies this student's old replies.
      if (Math.random() < 0.1) await pruneOldReplies(userId).catch(() => undefined);
    },
    isAway: () => readAway(userId, replyId),
    onSettle: async (outcome, content, notify) => {
      await writeReply(userId, replyId, { status: outcome, content: sanitizeForPostgres(content), startedAt });
      if (!notify) return;
      try {
        await dispatchPushToUser(userId, {
          title: "MedArt Copilot",
          body: language === "en" ? "Your answer is ready." : "Ta réponse est prête.",
          url: "/dashboard/assistant",
        });
      } catch (error) {
        console.error("[copilot-background] Notification non envoyée:", error instanceof Error ? error.message : error);
      }
    },
    keepAlive: (work) => waitUntil(work),
  });
}
