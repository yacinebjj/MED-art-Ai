-- Cross-device sync for everything a student generates or saves in the
-- browser (Workspace Résumé / Mots-clés / Dictionnaire history, assistant
-- conversations, saved messages, bookmarks, study progress...). Before this,
-- those lived only in one browser's localStorage: generated on PC, invisible
-- on the phone with the same account.
--
-- One row per document, grouped by namespace (e.g. "workspace-history:42").
-- `deleted` is a tombstone: a document removed on one device is not
-- re-uploaded from another device's stale local copy.
-- Writes go through the service-role client (app/api/user-sync); students may
-- only READ their own rows directly.
--
-- Idempotent: safe to run more than once.

create table if not exists public.user_sync_documents (
  user_id uuid not null references auth.users (id) on delete cascade,
  namespace text not null check (char_length(namespace) between 1 and 120),
  doc_key text not null check (char_length(doc_key) between 1 and 200),
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, namespace, doc_key)
);

create index if not exists user_sync_documents_ns_idx on public.user_sync_documents (user_id, namespace, updated_at desc);

alter table public.user_sync_documents enable row level security;
drop policy if exists "Users read own sync documents" on public.user_sync_documents;
create policy "Users read own sync documents" on public.user_sync_documents for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
