/**
 * Deleting a student's account and everything it holds — server-only
 * (service-role client). Used by app/api/account/delete.
 *
 * What goes, and how:
 *  - every row linked to the account by a foreign key to auth.users (profile,
 *    courses, notes, flashcards, exams, history, sync, group memberships and
 *    messages…): deleting the auth user cascades to all of them
 *    (supabase/schema.sql — every such key is ON DELETE CASCADE);
 *  - rows keyed by the user id as plain text, which nothing cascades to:
 *    subscriptions (plan, usage, e-mail), user_devices,
 *    user_device_replacements;
 *  - files: the student's folder in each bucket that stores files by user
 *    (uploads, avatar, exam references, recordings, relay parts), the
 *    attachments they posted in study groups, and their personal
 *    « Fiche de synthèse » images. Shared, content-addressed files (podcasts,
 *    shared sheets, the cross-student caches) hold nothing personal and stay.
 *  - kept: `payments`, the record of past transactions, needed for accounting.
 *
 * Done in an order that never loses what must survive:
 *  1. checks that refuse while money is in flight (deletionBlocker) — they all
 *     clear on their own, so a student is never stuck;
 *  2. study groups the student administers are handed to their oldest member
 *     (the cascade would otherwise delete every member's messages), or
 *     deleted when nobody else is in them;
 *  3. the paths of files referenced only by rows the cascade will delete are
 *     collected;
 *  4. the auth user is deleted (the cascade);
 *  5. best-effort clean-up of the text-keyed rows and the files — the account
 *     is already gone, so a failure here is logged, never reported as one.
 */

import type { getSupabaseAdmin } from "@/lib/supabase/server";
import { SOURCE_FILES_BUCKET } from "@/lib/course-source-storage";
import { EXAM_REFERENCES_BUCKET } from "@/lib/exam-reference-storage";
import { LECTURE_RECORDINGS_BUCKET } from "@/lib/lecture-notes-storage";
import { CHAT_MEDIA_BUCKET } from "@/lib/group-chat";
import { ENVELOPE_PREFIX, decodeEnvelope } from "@/lib/group-chat-envelope";
import { FICHE_STORAGE_FOLDER } from "@/lib/infographic-fiche-key";
import { removeStorageFolder, removeStorageObjects, storagePathFromPublicUrl } from "@/lib/storage-cleanup";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Buckets that file a student's objects under `${userId}/`. Their writers:
 * app/api/upload (+ /sign, /relay), app/api/study-planner/upload,
 * app/api/profile/avatar, app/api/exam/analyze-reference/sign,
 * app/api/lecture-notes/upload-url, app/api/upload/relay (parts).
 */
const USER_FOLDER_BUCKETS = [
  SOURCE_FILES_BUCKET,
  "study-plan-sources",
  "avatars",
  EXAM_REFERENCES_BUCKET,
  LECTURE_RECORDINGS_BUCKET,
  "upload-relay-parts",
] as const;

/** Bucket of the « Fiche de synthèse » images (app/api/studio/infographic). */
const INFOGRAPHIC_BUCKET = "studio-infographics";

/** A payment still this recent and pending may be about to be confirmed (lib/chargily-settlement.ts). */
const RECENT_PAYMENT_MS = 2 * 60 * 60 * 1000;

/** Group messages read at most per kind when collecting attachments. */
const MAX_MESSAGES_READ = 5_000;

/** Time allowed to the file clean-up, all buckets together. */
const CLEANUP_BUDGET_MS = 25_000;

/** Why the account can't be deleted right now. */
export interface DeletionBlocker {
  code: "payment_in_progress" | "refund_pending" | "group_purchase_in_progress" | "payment_pending" | "check_failed";
  message: string;
}

/** A table missing from this database (its migration not run): nothing of the kind to look at. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|could not find the table/i.test(error.message ?? ""));
}

const CHECK_FAILED: DeletionBlocker = {
  code: "check_failed",
  message: "Impossible de vérifier ton compte pour le moment. Réessaie dans un instant.",
};

/**
 * Refuses while money is in flight on the account, since the cascade would
 * erase the records needed to settle it: a group-purchase seat held, paid or
 * awaiting a refund (the student's own, or another student's in a group
 * purchase the student created), a refund request not yet processed, or a
 * payment started in the last two hours. A read that fails refuses too.
 *
 * @param supabase - Service-role client.
 * @param userId - The account.
 * @returns The first reason found, or null when deletion may proceed.
 */
export async function deletionBlocker(supabase: Admin, userId: string): Promise<DeletionBlocker | null> {
  const ownSeats = await supabase
    .from("billing_pool_members")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["holding", "paid", "refund_pending"])
    .limit(1);
  if (ownSeats.error && !isMissingTable(ownSeats.error)) return CHECK_FAILED;
  if ((ownSeats.data ?? []).length > 0) {
    return {
      code: "payment_in_progress",
      message: "Une place d'achat groupé est en cours sur ton compte (réservée, payée ou en remboursement). Réessaie une fois qu'elle est activée ou remboursée.",
    };
  }

  const refunds = await supabase.from("billing_refund_requests").select("id").eq("user_id", userId).eq("status", "pending").limit(1);
  if (refunds.error && !isMissingTable(refunds.error)) return CHECK_FAILED;
  if ((refunds.data ?? []).length > 0) {
    return { code: "refund_pending", message: "Un remboursement est en attente sur ton compte. Réessaie une fois qu'il a été effectué." };
  }

  const createdPools = await supabase.from("billing_pools").select("id").eq("created_by", userId);
  if (createdPools.error && !isMissingTable(createdPools.error)) return CHECK_FAILED;
  const poolIds = (createdPools.data ?? []).map((pool: { id: string }) => pool.id);
  if (poolIds.length > 0) {
    const othersInFlight = await supabase
      .from("billing_pool_members")
      .select("id")
      .in("pool_id", poolIds)
      .neq("user_id", userId)
      .in("status", ["holding", "paid", "refund_pending"])
      .limit(1);
    if (othersInFlight.error) return CHECK_FAILED;
    if ((othersInFlight.data ?? []).length > 0) {
      return {
        code: "group_purchase_in_progress",
        message: "Un achat groupé que tu as créé est en cours : d'autres étudiants y ont réservé ou payé une place. Réessaie une fois qu'il est complet ou expiré.",
      };
    }
  }

  const since = new Date(Date.now() - RECENT_PAYMENT_MS).toISOString();
  const payments = await supabase.from("payments").select("id").eq("user_id", userId).eq("status", "pending").gte("created_at", since).limit(1);
  if (payments.error && !isMissingTable(payments.error)) return CHECK_FAILED;
  if ((payments.data ?? []).length > 0) {
    return { code: "payment_pending", message: "Un paiement est en cours de traitement. Réessaie dans quelques minutes." };
  }
  return null;
}

/**
 * Study groups the student administers: deleting the account would delete
 * each of them with every member's messages (chat_groups.admin_id cascades).
 * Each goes to its oldest other accepted member; a group with nobody else
 * is deleted, with its attachments.
 *
 * @param supabase - Service-role client.
 * @param userId - The account.
 * @returns false when a read or write failed (nothing about the account has been deleted then).
 */
export async function handOverAdministeredGroups(supabase: Admin, userId: string): Promise<boolean> {
  const { data: groups, error } = await supabase.from("chat_groups").select("id").eq("admin_id", userId);
  if (error) return isMissingTable(error);
  for (const { id } of (groups ?? []) as { id: string }[]) {
    const { data: members, error: membersError } = await supabase
      .from("chat_members")
      .select("user_id")
      .eq("group_id", id)
      .eq("status", "accepted")
      .neq("user_id", userId)
      .order("joined_at", { ascending: true })
      .limit(1);
    if (membersError) return false;
    const successor = (members ?? [])[0] as { user_id: string } | undefined;
    if (successor) {
      const { error: updateError } = await supabase.from("chat_groups").update({ admin_id: successor.user_id }).eq("id", id).eq("admin_id", userId);
      if (updateError) return false;
    } else {
      const { error: deleteError } = await supabase.from("chat_groups").delete().eq("id", id).eq("admin_id", userId);
      if (deleteError) return false;
      await removeStorageFolder(supabase, CHAT_MEDIA_BUCKET, id);
    }
  }
  return true;
}

/** Files referenced only by rows the cascade deletes, by bucket. */
export type PersonalFiles = Map<string, string[]>;

/**
 * Collects, before the cascade deletes the rows pointing at them, the
 * attachments the student posted in study groups and their personal
 * « Fiche de synthèse » images. Best effort: a failed read just leaves those
 * files (logged).
 *
 * @param supabase - Service-role client.
 * @param userId - The account.
 * @returns Object paths by bucket.
 */
export async function collectPersonalFiles(supabase: Admin, userId: string): Promise<PersonalFiles> {
  const files: PersonalFiles = new Map([
    [CHAT_MEDIA_BUCKET, []],
    [INFOGRAPHIC_BUCKET, []],
  ]);

  // Photos / videos / voice notes (media_url), and documents, which travel in
  // a text message's envelope (lib/group-chat-envelope.ts).
  const [mediaRows, documentRows] = await Promise.all([
    supabase.from("chat_messages").select("media_url").eq("user_id", userId).not("media_url", "is", null).limit(MAX_MESSAGES_READ),
    supabase.from("chat_messages").select("content_text").eq("user_id", userId).like("content_text", `${ENVELOPE_PREFIX}%`).limit(MAX_MESSAGES_READ),
  ]);
  for (const result of [mediaRows, documentRows]) {
    if (result.error && !isMissingTable(result.error)) {
      console.error("[account-deletion] Lecture des pièces jointes de groupe échouée:", result.error.message);
    }
  }
  const attachmentUrls = [
    ...((mediaRows.data ?? []) as { media_url: string | null }[]).map((row) => row.media_url),
    ...((documentRows.data ?? []) as { content_text: string | null }[]).map((row) => decodeEnvelope(row.content_text).attachment?.url),
  ];
  for (const url of attachmentUrls) {
    const path = storagePathFromPublicUrl(url, CHAT_MEDIA_BUCKET);
    if (path) files.get(CHAT_MEDIA_BUCKET)!.push(path);
  }

  // Personal sheets are named `${contentHash}-${userId}.${ext}`; shared ones
  // (no user id) are other students' too and stay.
  const { data: courses, error: coursesError } = await supabase
    .from("studio_courses")
    .select("infographic_url")
    .eq("user_id", userId)
    .not("infographic_url", "is", null);
  if (coursesError && !/infographic_url/i.test(coursesError.message ?? "")) {
    console.error("[account-deletion] Lecture des fiches de synthèse échouée:", coursesError.message);
  }
  const personalSheet = new RegExp(`^${FICHE_STORAGE_FOLDER}/[^/]+-${userId.replace(/[^0-9a-f-]/gi, "")}\\.[a-z0-9]+$`, "i");
  for (const { infographic_url } of (courses ?? []) as { infographic_url: string | null }[]) {
    const path = storagePathFromPublicUrl(infographic_url, INFOGRAPHIC_BUCKET);
    if (path && personalSheet.test(path)) files.get(INFOGRAPHIC_BUCKET)!.push(path);
  }
  return files;
}

/**
 * After the auth user is gone: removes the rows keyed by the user id as text
 * and the student's files. Never throws; returns false when something was
 * left behind (each failure is logged).
 *
 * @param supabase - Service-role client.
 * @param userId - The deleted account.
 * @param personalFiles - What collectPersonalFiles found before the deletion.
 */
export async function cleanUpAfterDeletion(supabase: Admin, userId: string, personalFiles: PersonalFiles): Promise<boolean> {
  let complete = true;
  const deviceOwners = [userId, `inapp:${userId}`];
  const rowDeletes: [string, PromiseLike<{ error: { code?: string; message?: string } | null }>][] = [
    ["subscriptions", supabase.from("subscriptions").delete().eq("user_id", userId)],
    ["user_devices", supabase.from("user_devices").delete().in("user_id", deviceOwners)],
    ["user_device_replacements", supabase.from("user_device_replacements").delete().in("user_id", deviceOwners)],
  ];
  for (const [table, run] of rowDeletes) {
    try {
      const { error } = await run;
      if (error && !isMissingTable(error)) {
        complete = false;
        console.error(`[account-deletion] ${table} non nettoyé:`, error.message);
      }
    } catch (error) {
      complete = false;
      console.error(`[account-deletion] ${table} non nettoyé:`, error instanceof Error ? error.message : error);
    }
  }

  const deadlineAt = Date.now() + CLEANUP_BUDGET_MS;
  const folderResults = await Promise.all(USER_FOLDER_BUCKETS.map((bucket) => removeStorageFolder(supabase, bucket, userId, { deadlineAt })));
  const fileResults = await Promise.all(
    Array.from(personalFiles.entries()).map(([bucket, paths]) => removeStorageObjects(supabase, bucket, paths, { deadlineAt }))
  );
  if ([...folderResults, ...fileResults].some((result) => !result.complete)) {
    complete = false;
    console.error(`[account-deletion] Fichiers du compte ${userId} pas tous supprimés — à reprendre à la main.`);
  }
  return complete;
}
