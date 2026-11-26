/**
 * Removing a whole Supabase Storage folder, best effort.
 *
 * Storage has no "delete folder" call: the objects under a folder are listed
 * page by page (sub-folders included) and then removed in batches. Used once
 * the database rows that pointed at the files are already gone (a deleted
 * study group, a deleted account), so a failure here never blocks or undoes
 * that deletion — it is logged and reported as incomplete instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Objects per list() page. */
const LIST_PAGE_SIZE = 100;
/** Paths per remove() call (the Storage API refuses more than 1000). */
const REMOVE_BATCH_SIZE = 100;
/** Sub-folder levels explored below the folder (lecture recordings are user/upload/chunk). */
const MAX_DEPTH = 4;
/** Objects collected at most in one call, so a runaway folder cannot hold a request forever. */
const MAX_OBJECTS = 20_000;
/** Time budget when the caller gives none. */
const DEFAULT_BUDGET_MS = 10_000;

/** What removeStorageFolder() did. */
export interface FolderRemovalResult {
  /** Objects removed. */
  removed: number;
  /** True when every object found under the folder was removed and nothing was left unlisted. */
  complete: boolean;
}

/** A bucket that was never created holds nothing to remove. */
function isMissingBucket(error: { message?: string } | null | undefined): boolean {
  return /bucket not found/i.test(error?.message ?? "");
}

/**
 * Removes every object under `folder` in `bucket`. Never throws.
 *
 * @param supabase - A service-role client (listing and removing other people's
 *   files needs it).
 * @param bucket - The bucket name.
 * @param folder - The folder inside the bucket, e.g. a group id or a user id.
 *   Must be non-empty: an empty folder would mean the whole bucket, which is refused.
 * @param options.deadlineAt - Epoch ms after which no new list or remove call starts
 *   (default: 10 s from now). Several folders can share one deadline.
 * @returns How many objects were removed, and whether the folder is now empty.
 */
export async function removeStorageFolder(
  supabase: Pick<SupabaseClient, "storage">,
  bucket: string,
  folder: string,
  { deadlineAt = Date.now() + DEFAULT_BUDGET_MS }: { deadlineAt?: number } = {}
): Promise<FolderRemovalResult> {
  const root = folder.replace(/^\/+|\/+$/g, "");
  if (!root || root.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    console.error(`[storage-cleanup] Refused: invalid folder "${folder}" in bucket ${bucket}.`);
    return { removed: 0, complete: false };
  }

  const storage = supabase.storage.from(bucket);
  const paths: string[] = [];
  let removed = 0;
  let complete = true;

  try {
    // Depth-first walk; each folder is read to its end before its sub-folders.
    const pending: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
    walk: while (pending.length > 0) {
      const { path, depth } = pending.pop()!;
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        if (Date.now() > deadlineAt || paths.length >= MAX_OBJECTS) {
          complete = false;
          break walk;
        }
        const { data, error } = await storage.list(path, { limit: LIST_PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
        if (error) {
          if (isMissingBucket(error)) return { removed: 0, complete: true };
          console.error(`[storage-cleanup] Listing ${bucket}/${path} failed:`, error.message);
          complete = false;
          break;
        }
        const entries = data ?? [];
        for (const entry of entries) {
          const child = `${path}/${entry.name}`;
          // Folders come back as entries without an id.
          if (entry.id == null) {
            if (depth + 1 <= MAX_DEPTH) pending.push({ path: child, depth: depth + 1 });
            else complete = false;
          } else {
            paths.push(child);
          }
        }
        if (entries.length < LIST_PAGE_SIZE) break;
      }
    }

    for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
      if (Date.now() > deadlineAt) {
        complete = false;
        break;
      }
      const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
      const { data, error } = await storage.remove(batch);
      if (error) {
        console.error(`[storage-cleanup] Removing ${batch.length} object(s) from ${bucket}/${root} failed:`, error.message);
        complete = false;
        continue;
      }
      removed += data?.length ?? 0;
    }
    return { removed, complete };
  } catch (error) {
    console.error(`[storage-cleanup] ${bucket}/${root}:`, error instanceof Error ? error.message : error);
    return { removed, complete: false };
  }
}

/**
 * Removes the given objects of `bucket` (paths inside the bucket), in
 * batches. Never throws.
 *
 * @param supabase - A service-role client.
 * @param bucket - The bucket name.
 * @param paths - Object paths; empty and duplicate entries are ignored.
 * @param options.deadlineAt - Epoch ms after which no new remove call starts.
 * @returns How many objects were removed, and whether every batch went through.
 */
export async function removeStorageObjects(
  supabase: Pick<SupabaseClient, "storage">,
  bucket: string,
  paths: readonly string[],
  { deadlineAt = Date.now() + DEFAULT_BUDGET_MS }: { deadlineAt?: number } = {}
): Promise<FolderRemovalResult> {
  const unique = Array.from(new Set(paths.filter((path) => path.length > 0)));
  let removed = 0;
  let complete = true;
  try {
    for (let i = 0; i < unique.length; i += REMOVE_BATCH_SIZE) {
      if (Date.now() > deadlineAt) {
        complete = false;
        break;
      }
      const batch = unique.slice(i, i + REMOVE_BATCH_SIZE);
      const { data, error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        if (isMissingBucket(error)) return { removed, complete: true };
        console.error(`[storage-cleanup] Removing ${batch.length} object(s) from ${bucket} failed:`, error.message);
        complete = false;
        continue;
      }
      removed += data?.length ?? 0;
    }
    return { removed, complete };
  } catch (error) {
    console.error(`[storage-cleanup] ${bucket}:`, error instanceof Error ? error.message : error);
    return { removed, complete: false };
  }
}

/**
 * The object path inside `bucket` of one of its public URLs
 * (…/storage/v1/object/public/<bucket>/<path>), or null for any other URL.
 *
 * @param url - A URL stored in the database.
 * @param bucket - The bucket it should belong to.
 * @returns The decoded object path, or null.
 */
export function storagePathFromPublicUrl(url: unknown, bucket: string): string | null {
  if (typeof url !== "string") return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const rest = url.slice(at + marker.length).split(/[?#]/)[0];
  try {
    const path = decodeURIComponent(rest);
    return path && !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ? path : null;
  } catch {
    return null;
  }
}
