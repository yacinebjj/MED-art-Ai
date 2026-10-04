import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { sanitizeForPostgres } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cross-device sync store (table user_sync_documents, migration
 * 20261006_user_sync_documents.sql). Client helper: lib/user-sync.ts.
 *
 *  GET  ?ns=<namespace>[&key=<key>]  → documents of a namespace (tombstones included)
 *  PUT  { ns, key, data }            → upsert one document
 *  PUT  { ns, docs: [{key, data}] }  → upsert several (first-sync upload)
 *  DELETE { ns, key }                → tombstone
 *
 * Always scoped to the authenticated user on the server. No AI cost.
 */

const NAMESPACE_RE = /^[a-z0-9][a-z0-9:_.-]{0,119}$/;
const MAX_DOC_BYTES = 2_000_000;
const MAX_DOCS_PER_PUT = 100;
const LIST_LIMIT = 500;
const SYNC_RATE = { limit: 600, windowMs: 5 * 60_000 };

interface SyncRow {
  doc_key: string;
  data: unknown;
  deleted: boolean;
  updated_at: string;
}

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

function validKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= 200;
}

/** Missing table (migration not run yet): reads return empty, writes are no-ops — local storage keeps working. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /user_sync_documents/.test(error.message ?? "")));
}

async function guard(): Promise<{ userId: string } | NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return bad("Tu dois être connecté(e).", 401);
  if (!isSupabaseConfigured()) return bad("Supabase n'est pas configuré sur le serveur.", 500);
  const rl = rateLimit(`user-sync:${user.id}`, SYNC_RATE);
  if (!rl.allowed) return bad("Trop de synchronisations — réessaie dans un instant.", 429);
  return { userId: user.id };
}

export async function GET(request: NextRequest) {
  const auth = await guard();
  if (auth instanceof NextResponse) return auth;
  const ns = request.nextUrl.searchParams.get("ns") ?? "";
  if (!NAMESPACE_RE.test(ns)) return bad("Espace de synchronisation invalide.");
  const key = request.nextUrl.searchParams.get("key");

  let query = getSupabaseAdmin()
    .from("user_sync_documents")
    .select("doc_key, data, deleted, updated_at")
    .eq("user_id", auth.userId)
    .eq("namespace", ns)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (key !== null) {
    if (!validKey(key)) return bad("Clé invalide.");
    query = query.eq("doc_key", key);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ success: true, available: false, docs: [] });
    console.error("[user-sync] Lecture échouée:", error.message);
    return bad("Lecture de la synchronisation échouée.", 500);
  }
  return NextResponse.json({
    success: true,
    available: true,
    docs: ((data ?? []) as SyncRow[]).map((row) => ({ key: row.doc_key, data: row.deleted ? null : row.data, deleted: row.deleted, updatedAt: row.updated_at })),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await guard();
  if (auth instanceof NextResponse) return auth;
  let body: { ns?: unknown; key?: unknown; data?: unknown; docs?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("Corps de requête JSON invalide.");
  }
  const ns = body.ns;
  if (typeof ns !== "string" || !NAMESPACE_RE.test(ns)) return bad("Espace de synchronisation invalide.");
  const incoming: { key: unknown; data: unknown }[] = Array.isArray(body.docs) ? (body.docs as { key: unknown; data: unknown }[]) : [{ key: body.key, data: body.data }];
  if (incoming.length === 0 || incoming.length > MAX_DOCS_PER_PUT) return bad("Nombre de documents invalide.");

  const now = new Date().toISOString();
  const rows = [];
  for (const doc of incoming) {
    if (!validKey(doc.key) || doc.data === undefined) return bad("Document invalide.");
    const data = sanitizeForPostgres(doc.data);
    if (JSON.stringify(data).length > MAX_DOC_BYTES) return bad("Document trop volumineux.", 413);
    rows.push({ user_id: auth.userId, namespace: ns, doc_key: doc.key, data, deleted: false, updated_at: now });
  }
  const { error } = await getSupabaseAdmin().from("user_sync_documents").upsert(rows, { onConflict: "user_id,namespace,doc_key" });
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ success: true, available: false });
    console.error("[user-sync] Écriture échouée:", error.message);
    return bad("Écriture de la synchronisation échouée.", 500);
  }
  return NextResponse.json({ success: true, available: true, updatedAt: now });
}

export async function DELETE(request: NextRequest) {
  const auth = await guard();
  if (auth instanceof NextResponse) return auth;
  let body: { ns?: unknown; key?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("Corps de requête JSON invalide.");
  }
  if (typeof body.ns !== "string" || !NAMESPACE_RE.test(body.ns) || !validKey(body.key)) return bad("Document invalide.");
  const { error } = await getSupabaseAdmin()
    .from("user_sync_documents")
    .upsert({ user_id: auth.userId, namespace: body.ns, doc_key: body.key, data: null, deleted: true, updated_at: new Date().toISOString() }, { onConflict: "user_id,namespace,doc_key" });
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ success: true, available: false });
    console.error("[user-sync] Suppression échouée:", error.message);
    return bad("Suppression de la synchronisation échouée.", 500);
  }
  return NextResponse.json({ success: true, available: true });
}
