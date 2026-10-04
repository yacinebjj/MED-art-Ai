-- ---------------------------------------------------------------------------
-- AI cost audit (2026-10-06): cross-student caches that remove duplicate paid
-- AI calls. All tables are written/read by the server (service role) only.
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- 1. Explication parts (lib/explication-part-cache.ts). One row per generated
--    slice of a course source: an interrupted run keeps its paid parts, two
--    students on the same new course share every part, and finalize can
--    verify a submitted document against server-generated parts before
--    sharing it.
create table if not exists studio_explication_part_cache (
  source_hash text not null,
  variant text not null,
  part_key text not null,
  markdown text not null,
  created_at timestamptz not null default now(),
  primary key (source_hash, variant, part_key)
);

alter table studio_explication_part_cache enable row level security;
drop policy if exists "Deny all client access" on studio_explication_part_cache;
create policy "Deny all client access" on studio_explication_part_cache for all using (false);

-- 2. Results computed from an uploaded file, keyed by the file's sha256
--    (lib/ai-file-cache.ts): "ocr" (scanned PDF text) and "exam-style"
--    (style profile of an old exam paper).
create table if not exists ai_file_cache (
  file_sha256 text not null,
  kind text not null check (kind in ('ocr', 'exam-style')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (file_sha256, kind)
);

alter table ai_file_cache enable row level security;
drop policy if exists "Deny all client access" on ai_file_cache;
create policy "Deny all client access" on ai_file_cache for all using (false);

-- 3. Cross-course module synthesis (lib/module-synthesis.ts), keyed by the
--    sorted (content_hash, title) pairs of the selected courses.
create table if not exists module_cross_synthesis_cache (
  cache_key text primary key,
  content text not null,
  created_at timestamptz not null default now()
);

alter table module_cross_synthesis_cache enable row level security;
drop policy if exists "Deny all client access" on module_cross_synthesis_cache;
create policy "Deny all client access" on module_cross_synthesis_cache for all using (false);

-- 4. Atomic append of extension flashcards (lib/flashcards-content-cache.ts):
--    one statement, so two concurrent extensions can no longer erase each
--    other's (already paid) cards.
create or replace function append_flashcards_cache(p_content_hash text, p_cards jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into flashcards_content_cache (content_hash, cards_data)
  values (p_content_hash, p_cards)
  on conflict (content_hash)
  do update set cards_data = flashcards_content_cache.cards_data || excluded.cards_data;
$$;

revoke all on function append_flashcards_cache(text, jsonb) from public, anon, authenticated;
