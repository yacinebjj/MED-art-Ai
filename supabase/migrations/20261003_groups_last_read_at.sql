-- Groupes d'étude — optional, idempotent migration (safe to run several times).
--
-- The live database was missing chat_members.last_read_at (declared in
-- supabase/schema.sql but never applied). That single missing column made
-- GET /api/groups fail on every call, so every group looked deleted. The app
-- now works WITHOUT it (the route degrades), but running this restores:
--   - unread counters in the groups lobby,
--   - persistent "Vu" (✓✓) receipts, even when the reader is offline now.
--
-- Run once in Supabase → SQL Editor.

alter table chat_members add column if not exists last_read_at timestamptz not null default now();

create index if not exists chat_members_group_id_user_id_idx on chat_members (group_id, user_id);

-- Live group settings (rename, new invite code, admin hand-over) reach open
-- chat rooms through Realtime on chat_groups — make sure it is published.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_groups'
  ) then
    alter publication supabase_realtime add table chat_groups;
  end if;
end $$;
