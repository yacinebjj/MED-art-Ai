-- Med Art AI — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- All access happens server-side through the service-role key (see
-- lib/supabase/server.ts), so RLS is enabled with no public policies:
-- only the service role (which bypasses RLS) can read/write these tables.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- courses_cache: AI output keyed by a hash of the uploaded file's bytes.
-- Lets identical uploads (same student re-uploading, or different students
-- with the same course PDF) skip the AI call entirely.
-- ---------------------------------------------------------------------------
create table if not exists courses_cache (
  id uuid primary key default gen_random_uuid(),
  file_hash text not null unique,
  file_name text not null,
  course_text text not null,
  explication text not null,
  resume text not null,
  pieges text not null,
  astuces text not null,
  cas_clinique text not null,
  qcm text not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists courses_cache_file_hash_idx on courses_cache (file_hash);

alter table courses_cache enable row level security;

-- Atomic hit-counter bump, called on every cache hit (see lib/course-cache.ts).
create or replace function increment_cache_hit_count(p_file_hash text)
returns void
language sql
as $$
  update courses_cache set hit_count = hit_count + 1 where file_hash = p_file_hash;
$$;

-- ---------------------------------------------------------------------------
-- subscriptions: one row per student (student identity is a client-generated
-- UUID persisted in localStorage until real auth exists — see
-- lib/session.ts getOrCreateUserId()). Tracks the active plan, its validity
-- window, and how many fresh AI generations have been used this period.
-- ---------------------------------------------------------------------------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  email text,
  plan text not null check (plan in ('semestriel', 'annuel')),
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'cancelled')),
  period_start timestamptz,
  period_end timestamptz,
  generations_used integer not null default 0,
  generations_period_start timestamptz,
  chargily_checkout_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on subscriptions (user_id);

alter table subscriptions enable row level security;

-- Atomic quota-usage bump, called after every billable AI generation
-- (see lib/subscription.ts recordGeneration).
create or replace function increment_generations_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set generations_used = generations_used + 1, updated_at = now()
  where user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- Migration: 2-plan model (semestriel/annuel, sold only via Chargily) -> the
-- 6-plan model (freemium/basic/pro/max/semester/annual), where Freemium is a
-- permanent, un-purchased default floor every account has from day one.
-- Written as its own idempotent block (drop/re-add the constraint, add the
-- new column) rather than editing the original CREATE TABLE above, matching
-- this file's existing convention for evolving a table already in
-- production (see content_embedding's migration further down for the same
-- pattern). Safe to re-run.
-- ---------------------------------------------------------------------------
alter table subscriptions drop constraint if exists subscriptions_plan_check;
update subscriptions set plan = 'semester' where plan = 'semestriel';
update subscriptions set plan = 'annual' where plan = 'annuel';
alter table subscriptions add constraint subscriptions_plan_check
  check (plan in ('freemium', 'basic', 'pro', 'max', 'semester', 'annual'));

-- Highlight-chat quota, tracked alongside generations_used. Shares
-- generations_period_start as its rollover clock (see
-- lib/subscription.ts's ensureFreshUsagePeriod) rather than adding a second
-- timestamp column — both counters are monthly allowances that always reset
-- together, so one shared anchor is simpler and can't drift out of sync.
alter table subscriptions add column if not exists highlight_messages_used integer not null default 0;

create or replace function increment_highlight_messages_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set highlight_messages_used = highlight_messages_used + 1, updated_at = now()
  where user_id = p_user_id;
$$;

-- Backfill: every account created before this migration (or whose signup
-- trigger hiccupped) gets an implicit Freemium row too, exactly like the
-- profiles backfill below. Accounts that already have a row (paid or not)
-- are left untouched by the ON CONFLICT.
insert into subscriptions (user_id, email, plan, status, period_start, generations_used, generations_period_start, highlight_messages_used)
select id::text, email, 'freemium', 'active', now(), 0, now(), 0 from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- payments: one row per Chargily checkout attempt, for auditing/reconciliation.
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  plan text not null,
  amount integer not null,
  currency text not null default 'dzd',
  chargily_checkout_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'canceled')),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_id_idx on payments (user_id);
create index if not exists payments_chargily_checkout_id_idx on payments (chargily_checkout_id);

alter table payments enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created automatically on sign-up via the
-- trigger below. Currently only tracks the 7-day free trial window; the rest
-- of the profile (name, faculty, specialty, year) lives in
-- auth.users.user_metadata (see lib/auth.ts).
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "Users can view their own profile" on profiles;
create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

-- Creates a profiles row (and starts the trial) the moment a new auth user
-- is created — fires regardless of whether email confirmation is enabled,
-- so it can't be skipped by a client that never calls back.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, trial_ends_at)
  values (new.id, now() + interval '7 days')
  on conflict (id) do nothing;

  -- Every new signup gets an implicit Freemium row from day one (1 cours/mois,
  -- 10 messages highlight/mois) — see lib/subscription.ts's resolveEffectivePlan
  -- for why a Freemium row (not a null one) is what makes quota gating never
  -- need a lazy upsert race in application code.
  insert into public.subscriptions (user_id, email, plan, status, period_start, generations_used, generations_period_start, highlight_messages_used)
  values (new.id::text, new.email, 'freemium', 'active', now(), 0, now(), 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: give a fresh trial to any account created before this migration
-- ran (e.g. accounts created earlier during development/testing).
insert into profiles (id, trial_ends_at)
select id, now() + interval '7 days' from auth.users
on conflict (id) do nothing;

-- Belt-and-suspenders: trial_ends_at is NOT NULL by constraint, so this
-- should normally match zero rows — but if you ever find an existing row
-- with a null/missing trial and want to reset it to a fresh 7-day window,
-- this is the one-liner to run (safe to re-run, it's a no-op once fixed):
update profiles set trial_ends_at = now() + interval '7 days' where trial_ends_at is null;

-- ---------------------------------------------------------------------------
-- user_courses: one row per uploaded course, owned by the student who
-- uploaded it — powers both the dashboard grid and the workspace. Upload
-- only extracts and stores `source_text`; no AI call happens until the
-- student opens a Studio artifact (see course_content_cache below), which
-- is the whole point of the on-demand model (cost control).
-- ---------------------------------------------------------------------------
create table if not exists user_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  subject text not null,
  file_type text not null,
  file_size_label text not null,
  status text not null check (status in ('processing', 'ready', 'error')),
  source_text text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_courses_user_id_idx on user_courses (user_id);

alter table user_courses enable row level security;

drop policy if exists "Users can view their own courses" on user_courses;
create policy "Users can view their own courses"
  on user_courses for select
  using (auth.uid() = user_id);

-- Idempotent upgrades for projects that already ran an earlier version of
-- this table (file_hash/cached are retired in favour of course_content_cache
-- below; source_text is new; file_type's check is dropped so 'txt' pasted
-- courses are accepted too).
alter table user_courses add column if not exists source_text text;
alter table user_courses drop constraint if exists user_courses_file_type_check;

-- ---------------------------------------------------------------------------
-- course_content_cache: on-demand AI artifacts, one row per
-- (course, content type) — e.g. ('c1', 'cours_oral'), ('c1', 'qcm'). Checked
-- before every OpenRouter call; a hit costs 0 tokens. This is per-course
-- (not shared globally by file hash like the old courses_cache table) since
-- each course now belongs to exactly one student's own upload.
-- ---------------------------------------------------------------------------
create table if not exists course_content_cache (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references user_courses (id) on delete cascade,
  content_type text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, content_type)
);

create index if not exists course_content_cache_course_id_idx on course_content_cache (course_id);

alter table course_content_cache enable row level security;

drop policy if exists "Users can view their own course content" on course_content_cache;
create policy "Users can view their own course content"
  on course_content_cache for select
  using (
    exists (
      select 1 from user_courses
      where user_courses.id = course_content_cache.course_id
      and user_courses.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Sub-unit chunking migration: "cas_clinique" and "qcm" are no longer filled
-- by one mega-prompt call — each is split into several independent sub-units
-- (5 clinical cases; 4 QCM batches + 1 QROC batch, see lib/sub-units.ts) so
-- they can be generated concurrently (Promise.all) and cached individually.
-- sub_unit_id defaults to '' (not null, so the unique constraint below
-- actually enforces uniqueness for it) for every other content type, which
-- still has exactly one row per (course, content type) as before.
-- ---------------------------------------------------------------------------
alter table course_content_cache add column if not exists sub_unit_id text not null default '';

alter table course_content_cache drop constraint if exists course_content_cache_course_id_content_type_key;
alter table course_content_cache drop constraint if exists course_content_cache_course_id_content_type_sub_unit_id_key;
alter table course_content_cache
  add constraint course_content_cache_course_id_content_type_sub_unit_id_key
  unique (course_id, content_type, sub_unit_id);

-- ---------------------------------------------------------------------------
-- courses, modules, course_chat_history: these three tables power the public
-- Studio pipeline (app/api/generate/*, app/dashboard/demo/**,
-- app/api/courses/chat). They were originally created ad hoc directly in the
-- Supabase SQL editor and were never captured here. The definitions below
-- were reverse-engineered column-by-column from every app/lib call site that
-- reads or writes them (select/insert/update strings, TS row types), so this
-- file finally becomes a real, versioned source of truth instead of trailing
-- the live database. Everything uses `if not exists`, so running this
-- against a database that already has these tables is a safe no-op — it
-- will not alter or touch a single existing row.
--
-- Note the column is `"resumé"` — WITH the French accent — not `resume`.
-- Confirmed directly from lib/course-generation-shared.ts's
-- `resume: { dbColumn: "resumé" }` mapping and this file's own
-- match_similar_courses_by_slug() below, which casts `c.resumé::text`. The
-- ASCII "resume" only ever exists as a client-side select alias
-- ("resume:resumé") because supabase-js's select-string parser can't
-- statically parse an accented identifier.
-- ---------------------------------------------------------------------------
create extension if not exists vector;

create table if not exists modules (
  id bigint generated by default as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table modules enable row level security;

create table if not exists courses (
  id bigint generated by default as identity primary key,
  slug text not null unique,
  title text not null,
  raw_text text,
  content_embedding vector(1536),
  explication text,
  "resumé" jsonb,
  cas_clinique jsonb,
  qcms jsonb,
  mind_map jsonb,
  -- Legacy/dead column from the removed "Mode Visuel" feature. Never read or
  -- written by current app code (see app/api/courses/slug/[slug]/route.ts's
  -- comment on why it's deliberately never selected) — kept only so any old
  -- row that may still physically hold data in it isn't silently dropped.
  mode_visuel jsonb,
  module_id bigint references modules (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists courses_slug_idx on courses (slug);
create index if not exists courses_module_id_idx on courses (module_id);

alter table courses enable row level security;

create table if not exists course_chat_history (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  course_slug text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists course_chat_history_user_slug_idx
  on course_chat_history (user_id, course_slug, created_at);

alter table course_chat_history enable row level security;

drop policy if exists "Users can view their own chat history" on course_chat_history;
create policy "Users can view their own chat history"
  on course_chat_history for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- AI Mind Map: 6th on-demand Studio section, same lazy-generation pipeline
-- as explication/mode_visuel/resume/cas_clinique/qcms (see
-- lib/course-generation-shared.ts SECTION_CONFIG). jsonb, not text, since the
-- stored value is a { nodes, links } graph object, not prose.
-- ---------------------------------------------------------------------------
alter table courses add column if not exists mind_map jsonb;

-- ---------------------------------------------------------------------------
-- Exemples & Analogies: 7th on-demand Studio section, same lazy-generation
-- pipeline as the others (see lib/course-generation-shared.ts SECTION_CONFIG,
-- lib/prompts/public-course-sections.ts EXEMPLES_ANALOGIES_SYSTEM_PROMPT).
-- text, not jsonb, like `explication` — the stored value is a Markdown
-- string (Darija/Arabic script mixed with French medical terms), not a
-- structured object.
-- ---------------------------------------------------------------------------
alter table courses add column if not exists exemples_analogies text;

-- ---------------------------------------------------------------------------
-- qcm_attempts: one row per (student, course, QCM) — a repeat attempt
-- UPDATEs the same row (via upsert onConflict) rather than inserting a new
-- one, so leitner_box/next_review_at always reflect the latest state. Powers
-- the Leitner spaced-repetition scheduler (lib/srs.ts) via
-- app/api/srs/attempt, app/api/srs/due and, through the weakness_radar
-- function below, app/api/srs/weakness-radar.
-- ---------------------------------------------------------------------------
create table if not exists qcm_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_slug text not null,
  qcm_id text not null,
  is_correct boolean not null,
  leitner_box integer not null default 1,
  next_review_at timestamptz not null default now(),
  attempted_at timestamptz not null default now(),
  unique (user_id, course_slug, qcm_id)
);

create index if not exists qcm_attempts_user_next_review_idx on qcm_attempts (user_id, next_review_at);

alter table qcm_attempts enable row level security;

drop policy if exists "Users can view their own QCM attempts" on qcm_attempts;
create policy "Users can view their own QCM attempts"
  on qcm_attempts for select
  using (auth.uid() = user_id);

-- Mastery percentage per module (Gastroentérologie, Infectiologie, ...) for
-- one student, called by app/api/srs/weakness-radar/route.ts via
-- supabase.rpc("weakness_radar", { p_user_id }). Joins through courses.slug
-- (qcm_attempts has no direct module_id — a course can move between modules
-- via the dashboard's "Déplacer" action, so deriving the module from the
-- course at query time, rather than freezing it on the attempt row, keeps
-- past attempts correctly attributed after a course is reorganized).
create or replace function weakness_radar(p_user_id uuid)
returns table (
  module_id bigint,
  module_name text,
  total_attempts bigint,
  correct_attempts bigint,
  mastery_pct numeric
)
language sql stable
as $$
  select
    m.id as module_id,
    m.name as module_name,
    count(*) as total_attempts,
    count(*) filter (where qa.is_correct) as correct_attempts,
    round(100.0 * count(*) filter (where qa.is_correct) / count(*), 1) as mastery_pct
  from qcm_attempts qa
  join courses c on c.slug = qa.course_slug
  join modules m on m.id = c.module_id
  where qa.user_id = p_user_id
  group by m.id, m.name
  order by mastery_pct asc;
$$;

-- ---------------------------------------------------------------------------
-- semantic_cache: cross-student cache of (question, answer) pairs, matched by
-- cosine similarity over pgvector rather than exact text — see
-- lib/ai/semantic-cache.ts getCachedOrGenerate(). Column names here MUST
-- match that file's .insert({ course_slug, question, answer, embedding })
-- call exactly (it writes "question"/"answer", not "chunk_text").
-- ---------------------------------------------------------------------------
create extension if not exists vector;

create table if not exists semantic_cache (
  id uuid primary key default gen_random_uuid(),
  course_slug text,
  question text not null,
  answer text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

-- IVFFlat needs at least some rows to build meaningful lists; fine to create
-- empty; Supabase docs recommend re-running `analyze` after the table has
-- real data (a handful of qualifying rows) to reach optimal recall.
create index if not exists semantic_cache_embedding_idx
  on semantic_cache using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists semantic_cache_course_slug_idx on semantic_cache (course_slug);

alter table semantic_cache enable row level security;

-- Cosine-similarity search, filtered by course when match_course_slug is
-- given, across all courses when it's null (see the comment on
-- getCachedOrGenerate() in lib/ai/semantic-cache.ts for why cross-course
-- search is sometimes desirable). match_threshold matches
-- SIMILARITY_THRESHOLD (0.92) in that same file.
create or replace function match_semantic_cache(
  query_embedding vector(1536),
  match_course_slug text,
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  question text,
  answer text,
  similarity float
)
language sql stable
as $$
  select
    semantic_cache.id,
    semantic_cache.question,
    semantic_cache.answer,
    1 - (semantic_cache.embedding <=> query_embedding) as similarity
  from semantic_cache
  where (match_course_slug is null or semantic_cache.course_slug = match_course_slug)
    and 1 - (semantic_cache.embedding <=> query_embedding) >= match_threshold
  order by semantic_cache.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- content_embedding: one embedding per course, computed ONCE at upload from
-- raw_text (see app/api/generate-course/route.ts) — a fingerprint of the
-- COURSE CONTENT itself. Distinct from `semantic_cache.embedding`, which
-- fingerprints student QUESTIONS — different table, different purpose,
-- never conflate the two.
--
-- Powers "Silent Semantic Deduplication" (lib/course-generation-shared.ts
-- generateCourseSection()): before paying for a real OpenRouter call to
-- generate a section, the app checks whether another course — any slug, any
-- faculty, any professor's phrasing/"كركاسة" — already has near-identical
-- raw_text (cosine similarity > 0.90) AND already has that exact section
-- generated. If so, the section is cloned in, 0$, invisible to the student:
-- their row, their chat history, their QCM attempts stay fully independent —
-- only the generated explanation/JSON payload is reused.
--
-- Existing rows uploaded before this migration have content_embedding = null
-- and simply never participate (neither as a source nor a candidate) until
-- backfilled — acceptable since this only needs to cover NEW uploads going
-- forward; backfilling old rows is a separate, optional maintenance task.
-- ---------------------------------------------------------------------------
alter table courses add column if not exists content_embedding vector(1536);

create index if not exists courses_content_embedding_idx
  on courses using ivfflat (content_embedding vector_cosine_ops)
  with (lists = 100);

-- Finds other courses whose raw_text is near-identical to the course at
-- p_slug, returning enough of each candidate's already-generated sections
-- for the caller to pick, per section, whichever candidate already has that
-- exact section filled. The self-join (`self` subquery) keeps the query
-- embedding entirely inside Postgres — the caller passes only a slug, never
-- a raw vector(1536), so there is no vector-serialization round-trip through
-- JS to get wrong. Section columns are cast to `text` because some
-- environments store them as jsonb and others as plain text (see
-- parseJsonColumn() in app/api/courses/slug/[slug]/route.ts) — casting
-- normalizes both to a string the caller JSON.parse()s itself, exactly like
-- every other read path in this app already does.
create or replace function match_similar_courses_by_slug(
  p_slug text,
  match_threshold float,
  match_count int
)
returns table (
  slug text,
  similarity float,
  explication text,
  mode_visuel text,
  resume text,
  cas_clinique text,
  qcms text,
  mind_map text,
  exemples_analogies text
)
language sql stable
as $$
  select
    c.slug,
    1 - (c.content_embedding <=> self.content_embedding) as similarity,
    c.explication,
    c.mode_visuel::text,
    c.resumé::text as resume,
    c.cas_clinique::text,
    c.qcms::text,
    c.mind_map::text,
    c.exemples_analogies
  from courses c, (select content_embedding from courses where slug = p_slug) as self
  where c.content_embedding is not null
    and self.content_embedding is not null
    and c.slug <> p_slug
    and 1 - (c.content_embedding <=> self.content_embedding) >= match_threshold
  order by c.content_embedding <=> self.content_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- course_source_chunks: fine-grained, SECTION-LEVEL Smart Clone matching —
-- distinct from `course_chunks` below, which only ever holds ALREADY
-- GENERATED content (search, not dedup) and is therefore empty and useless
-- for a brand-new upload with nothing generated yet. This table chunks the
-- RAW SOURCE TEXT instead (available immediately at upload, before any
-- generation — see app/api/generate-course/route.ts and
-- lib/search/source-chunking.ts), so a new course can be compared against
-- existing courses at the paragraph level, not just as one whole-document
-- vector.
--
-- Why this exists alongside content_embedding above: a single whole-document
-- cosine score can miss a real match — two courses whose actual medical
-- content is 90% identical but whose cover page, OCR artifacts, or section
-- ordering differ enough dilute that ONE score below the 0.90 threshold.
-- Comparing chunk-by-chunk catches that: even when the whole document
-- wouldn't match, individual paragraphs still can. See
-- match_similar_source_chunks() below and the chunk-based Smart Clone check
-- in lib/course-generation-shared.ts (generateCourseSection()) for how the
-- fraction of matched chunks gates cloning.
-- ---------------------------------------------------------------------------
create table if not exists course_source_chunks (
  id bigint generated by default as identity primary key,
  course_slug text not null references courses (slug) on delete cascade,
  chunk_index integer not null default 0,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (course_slug, chunk_index)
);

create index if not exists course_source_chunks_embedding_idx
  on course_source_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists course_source_chunks_course_slug_idx on course_source_chunks (course_slug);

alter table course_source_chunks enable row level security;

-- For every chunk of p_slug, finds its single closest match among every
-- OTHER course's chunks (lateral join, top-1 per chunk — cheap, and enough:
-- the caller only needs to know IF a chunk matched somewhere strongly
-- enough, not every course it's similar to), then aggregates per candidate
-- course: how many of p_slug's chunks matched THAT candidate at
-- >= match_threshold, out of how many chunks p_slug has in total. The
-- caller divides matched/total to get a coverage ratio and decides whether
-- to clone a section from that candidate. Note: picking only the single
-- globally-closest match per chunk means a strong runner-up candidate can be
-- under-credited for that chunk — a deliberate simplicity/cost trade-off,
-- not a correctness bug.
create or replace function match_similar_source_chunks(
  p_slug text,
  match_threshold float
)
returns table (
  candidate_slug text,
  matched_chunks bigint,
  total_chunks bigint
)
language sql stable
as $$
  with target_chunks as (
    select id, embedding from course_source_chunks where course_slug = p_slug
  ),
  best_per_chunk as (
    select
      tc.id as target_chunk_id,
      best.course_slug as candidate_slug,
      best.similarity
    from target_chunks tc
    cross join lateral (
      select csc.course_slug, 1 - (csc.embedding <=> tc.embedding) as similarity
      from course_source_chunks csc
      where csc.course_slug <> p_slug
      order by csc.embedding <=> tc.embedding
      limit 1
    ) best
  )
  select
    candidate_slug,
    count(*) filter (where similarity >= match_threshold) as matched_chunks,
    (select count(*) from target_chunks) as total_chunks
  from best_per_chunk
  group by candidate_slug
  having count(*) filter (where similarity >= match_threshold) > 0
  order by matched_chunks desc
  limit 10;
$$;

-- ---------------------------------------------------------------------------
-- course_explication_chapters: per-CHAPTER storage of the "Explication
-- ultra-détaillée" section, keyed to which of THIS course's own
-- course_source_chunks paragraph-chunks each chapter was written from.
--
-- Why this exists: Smart Clone above (both variants) is all-or-nothing per
-- SECTION — clone the whole thing or generate the whole thing. For
-- Explication specifically (the single most expensive section, dominated by
-- output tokens), that's wasteful when two courses on the same topic are
-- 90% identical and only 1 of 10 paragraphs actually changed: today's
-- Smart Clone would either clone 100% (if the whole-course match is close
-- enough) or regenerate 100% (if it isn't) — never "reuse the 9 unchanged
-- chapters, regenerate only the 1 that changed." source_chunk_indices
-- records which of course_source_chunks' chunk_index values this chapter
-- was generated from, so a FUTURE course's chunk-level match against THIS
-- course (see match_chunks_against_course below) can tell, per chapter,
-- whether it's still valid to reuse or needs regenerating. See
-- lib/course-generation-shared.ts's runExplicationDeltaPipeline().
-- ---------------------------------------------------------------------------
create table if not exists course_explication_chapters (
  id bigint generated by default as identity primary key,
  course_slug text not null references courses (slug) on delete cascade,
  chapter_index integer not null,
  heading text not null,
  content text not null,
  source_chunk_indices integer[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (course_slug, chapter_index)
);

create index if not exists course_explication_chapters_course_slug_idx
  on course_explication_chapters (course_slug);

alter table course_explication_chapters enable row level security;

-- Unlike match_similar_source_chunks above (which finds the best match
-- across ALL other courses, aggregated), this compares p_slug's chunks
-- against ONE SPECIFIC candidate course only, and returns the per-chunk
-- detail (not just a coverage ratio) — the caller needs to know EXACTLY
-- which of its own chunk_index values matched, so it can look up which
-- course_explication_chapters rows (keyed by source_chunk_indices) remain
-- reusable and which don't.
create or replace function match_chunks_against_course(
  p_slug text,
  p_candidate_slug text,
  match_threshold float
)
returns table (
  target_chunk_index integer,
  candidate_chunk_index integer,
  similarity float
)
language sql stable
as $$
  select
    tc.chunk_index as target_chunk_index,
    best.chunk_index as candidate_chunk_index,
    best.similarity
  from course_source_chunks tc
  cross join lateral (
    select csc.chunk_index, 1 - (csc.embedding <=> tc.embedding) as similarity
    from course_source_chunks csc
    where csc.course_slug = p_candidate_slug
    order by csc.embedding <=> tc.embedding
    limit 1
  ) best
  where tc.course_slug = p_slug
    and best.similarity >= match_threshold;
$$;

-- ---------------------------------------------------------------------------
-- course_chunks: real semantic search over course content (Explication,
-- Résumé, Cas Clinique, QCM/QROC, Exemples & Analogies) — see
-- lib/search/chunking.ts for how one course row becomes several chunks, and
-- app/api/search/route.ts for the self-healing "index any course that has
-- never been chunked yet, right on the first search that runs after it"
-- flow. Distinct from `content_embedding` above (one embedding for a WHOLE
-- course, used only for upload deduplication) and from `semantic_cache`
-- (caches chatbot Q&A, not course content) — three different pgvector uses,
-- never conflate them.
-- ---------------------------------------------------------------------------
create table if not exists course_chunks (
  id bigint generated by default as identity primary key,
  course_slug text not null,
  module_id bigint references modules (id) on delete set null,
  section_label text not null,
  chunk_index integer not null default 0,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (course_slug, section_label, chunk_index)
);

create index if not exists course_chunks_embedding_idx
  on course_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists course_chunks_course_slug_idx on course_chunks (course_slug);

alter table course_chunks enable row level security;

-- Cosine-similarity search across every indexed chunk, regardless of course
-- or module — app/api/search/route.ts resolves course title/module name
-- afterwards via a plain lookup, kept out of this function so it stays a
-- simple, reusable primitive.
create or replace function match_course_chunks(query_embedding vector(1536), match_count int)
returns table (
  course_slug text,
  section_label text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    course_chunks.course_slug,
    course_chunks.section_label,
    course_chunks.content,
    1 - (course_chunks.embedding <=> query_embedding) as similarity
  from course_chunks
  order by course_chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- course_mastery: same real qcm_attempts data as weakness_radar above, but
-- aggregated per COURSE instead of per module — powers the performance
-- indicators on individual course cards AND the "Statistiques" modal in
-- "Mes Cours Récents" (see app/api/srs/course-mastery/route.ts,
-- components/dashboard/PublicCourseCard.tsx and CourseStatsModal.tsx). No
-- join to courses/modules needed: qcm_attempts already carries course_slug
-- directly.
--
-- avg_leitner_box is the real SRS/memorization signal for the Statistiques
-- modal's "Indice de mémorisation" bar: lib/srs.ts's Leitner scheduler moves
-- a card from box 1 (just missed) up to MAX_LEITNER_BOX=5 (well memorized)
-- on every correct answer, straight back to 1 on any miss — so the average
-- box across a course's attempts is a real, already-computed proxy for how
-- durably memorized that course's material is, not a fabricated number.
-- ---------------------------------------------------------------------------
create or replace function course_mastery(p_user_id uuid)
returns table (
  course_slug text,
  total_attempts bigint,
  correct_attempts bigint,
  mastery_pct numeric,
  avg_leitner_box numeric
)
language sql stable
as $$
  select
    qa.course_slug,
    count(*) as total_attempts,
    count(*) filter (where qa.is_correct) as correct_attempts,
    round(100.0 * count(*) filter (where qa.is_correct) / count(*), 1) as mastery_pct,
    round(avg(qa.leitner_box), 2) as avg_leitner_box
  from qcm_attempts qa
  where qa.user_id = p_user_id
  group by qa.course_slug;
$$;

-- ---------------------------------------------------------------------------
-- course_weak_qcms: the individual weakest QCM/QROC attempts for one
-- student in one course — powers the "Statistiques" modal's "Points
-- faibles" section (see app/api/srs/course-weak-points/route.ts,
-- lib/weak-points.ts, components/dashboard/CourseStatsModal.tsx). "Weak"
-- combines both signals the feature asks for: currently missed
-- (is_correct = false) OR still fragile even though last answered
-- correctly (leitner_box <= 2, i.e. gotten right at most once so far) — see
-- lib/srs.ts's computeNextReview for why a miss always means leitner_box=1,
-- so this single filter naturally covers "wrong" and "barely holding on".
-- Ordered weakest-and-oldest-stuck first.
-- ---------------------------------------------------------------------------
create or replace function course_weak_qcms(p_user_id uuid, p_course_slug text, p_limit int default 8)
returns table (
  qcm_id text,
  is_correct boolean,
  leitner_box integer,
  attempted_at timestamptz
)
language sql stable
as $$
  select qa.qcm_id, qa.is_correct, qa.leitner_box, qa.attempted_at
  from qcm_attempts qa
  where qa.user_id = p_user_id
    and qa.course_slug = p_course_slug
    and (qa.is_correct = false or qa.leitner_box <= 2)
  order by qa.leitner_box asc, qa.attempted_at asc
  limit p_limit;
$$;

-- ===========================================================================
-- Curriculum officiel (spécialité -> année -> unité d'enseignement -> module)
--
-- Tables préfixées `curriculum_` À DESSEIN. Le cahier des charges demandait
-- une table nommée `modules`, mais une table `modules` existe déjà plus haut
-- dans ce fichier (id, name, created_at) : c'est le dossier PERSONNEL et
-- ad-hoc qu'un étudiant crée lui-même via "Ajouter à un module" sur une
-- carte de cours — déjà référencé en dur par `courses.module_id`,
-- `app/api/modules/route.ts`, `app/api/search/route.ts`, `ModuleBentoGrid`
-- et `weakness_radar`. Réutiliser ce même nom pour le référentiel OFFICIEL
-- du programme algérien (deux concepts totalement différents qui partagent
-- juste le mot français "module") aurait soit fait échouer ce script
-- (collision de nom de table), soit — si on avait renommé/supprimé
-- l'ancienne table — cassé silencieusement toutes ces fonctionnalités
-- réelles déjà en production. D'où le préfixe : zéro collision, zéro risque
-- de régression sur l'existant.
-- ===========================================================================

create table if not exists curriculum_specialties (
  id bigint generated by default as identity primary key,
  name text not null unique
);

alter table curriculum_specialties enable row level security;
drop policy if exists "Public read access" on curriculum_specialties;
create policy "Public read access" on curriculum_specialties for select using (true);

create table if not exists curriculum_academic_years (
  id bigint generated by default as identity primary key,
  specialty_id bigint not null references curriculum_specialties (id) on delete cascade,
  level integer not null check (level between 1 and 6),
  name text not null,
  unique (specialty_id, level)
);

create index if not exists curriculum_academic_years_specialty_id_idx on curriculum_academic_years (specialty_id);

alter table curriculum_academic_years enable row level security;
drop policy if exists "Public read access" on curriculum_academic_years;
create policy "Public read access" on curriculum_academic_years for select using (true);

-- NOTE : `unit_order`/`module_order` ci-dessous (au lieu de `display_order`
-- dans la première version de cette migration) — ce script a été ajusté
-- pour refléter exactement le nom de colonne réellement utilisé lors de
-- l'exécution en base, après avoir constaté un mismatch (l'API renvoyait
-- "column ... does not exist"). Garder ce fichier synchronisé avec la
-- réalité de la base évite qu'il devienne une source de vérité fausse pour
-- un futur environnement.
create table if not exists curriculum_teaching_units (
  id bigint generated by default as identity primary key,
  year_id bigint not null references curriculum_academic_years (id) on delete cascade,
  title text not null,
  unit_order integer not null default 0,
  unique (year_id, title)
);

create index if not exists curriculum_teaching_units_year_id_idx on curriculum_teaching_units (year_id);

alter table curriculum_teaching_units enable row level security;
drop policy if exists "Public read access" on curriculum_teaching_units;
create policy "Public read access" on curriculum_teaching_units for select using (true);

-- `teaching_unit_id` est le champ CRUCIAL : NULL = module indépendant
-- (rattaché directement à l'année, sans unité parente) ; renseigné =
-- sous-module de cette unité d'enseignement. `year_id` est dupliqué ici
-- (plutôt que déduit via une jointure) pour permettre de filtrer tous les
-- modules d'une année en une seule requête plate, sans jointure — la
-- cohérence entre les deux est garantie par le trigger juste après.
create table if not exists curriculum_modules (
  id bigint generated by default as identity primary key,
  year_id bigint not null references curriculum_academic_years (id) on delete cascade,
  teaching_unit_id bigint references curriculum_teaching_units (id) on delete cascade,
  title text not null,
  module_order integer not null default 0
);

create index if not exists curriculum_modules_year_id_idx on curriculum_modules (year_id);
create index if not exists curriculum_modules_teaching_unit_id_idx on curriculum_modules (teaching_unit_id);

-- Deux index uniques partiels plutôt qu'une seule contrainte unique(year_id,
-- teaching_unit_id, title) : en PostgreSQL deux NULL ne sont jamais égaux
-- pour une contrainte unique classique, donc "Immunologie" aurait pu être
-- inséré deux fois par erreur sans jamais déclencher de conflit. Ces deux
-- index gèrent explicitement chaque cas (sous-module / module indépendant).
create unique index if not exists curriculum_modules_unit_title_uidx
  on curriculum_modules (teaching_unit_id, title) where teaching_unit_id is not null;
create unique index if not exists curriculum_modules_year_title_independent_uidx
  on curriculum_modules (year_id, title) where teaching_unit_id is null;

alter table curriculum_modules enable row level security;
drop policy if exists "Public read access" on curriculum_modules;
create policy "Public read access" on curriculum_modules for select using (true);

-- Garde-fou d'intégrité : si un module déclare un teaching_unit_id, l'année
-- de cette unité DOIT correspondre à l'année du module — sinon un module
-- pourrait se retrouver rattaché à une UE d'une toute autre année. Un CHECK
-- ne peut pas faire cette vérification inter-tables, d'où le trigger.
create or replace function enforce_curriculum_module_year_matches_unit()
returns trigger
language plpgsql
as $$
begin
  if new.teaching_unit_id is not null then
    if not exists (
      select 1 from curriculum_teaching_units
      where id = new.teaching_unit_id and year_id = new.year_id
    ) then
      raise exception 'curriculum_modules.year_id (%) ne correspond pas au year_id de curriculum_teaching_units.id=%', new.year_id, new.teaching_unit_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists curriculum_modules_year_consistency on curriculum_modules;
create trigger curriculum_modules_year_consistency
  before insert or update on curriculum_modules
  for each row execute function enforce_curriculum_module_year_matches_unit();

-- ---------------------------------------------------------------------------
-- SUPERSEDED — kept only so a project that already ran this isn't left with
-- an orphaned table; current app code no longer reads or writes it. This
-- table's own PostgREST schema-cache entry never picked up in practice (a
-- "Could not find the table 'public.user_module_flashcards' in the schema
-- cache" error persisted even after `NOTIFY pgrst, 'reload schema'`), so the
-- toggle was moved onto `profiles.flashcard_active_module_ids` below instead
-- — an ALREADY-recognized table (see specialty_id/academic_year_id columns
-- added to `profiles` further up, both working in production), so adding
-- one more column to it needs no fresh table for PostgREST to discover.
-- ---------------------------------------------------------------------------
create table if not exists user_module_flashcards (
  user_id uuid not null references auth.users (id) on delete cascade,
  curriculum_module_id bigint not null references curriculum_modules (id) on delete cascade,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, curriculum_module_id)
);

create index if not exists user_module_flashcards_active_idx
  on user_module_flashcards (user_id) where active = true;

alter table user_module_flashcards enable row level security;
drop policy if exists "Users manage their own flashcard activations" on user_module_flashcards;
create policy "Users manage their own flashcard activations"
  on user_module_flashcards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Current home of the "Activer les Flashcards" toggle (dashboard module
-- card, CurriculumView.tsx) — a plain integer array on the student's own
-- `profiles` row, not a join table. Never a column on `curriculum_modules`
-- itself — that table has no user_id and is shared/public-read across every
-- student (see its own "Public read access" policy above), so a boolean
-- there would mean one student's toggle silently activates/deactivates
-- flashcards for every other student on that same official module.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists flashcard_active_module_ids integer[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Anki-style Q&A flashcard queue — one array PER COURSE, on `studio_courses`
-- itself, mirroring that table's own `qcms` jsonb column exactly (same
-- table, same proven-working PostgREST pattern, rather than a brand-new
-- table). Each element is `{id, question, answer}`, appended to by
-- app/api/flashcards/generate/route.ts and read by
-- app/api/flashcards/pool/route.ts across every course in the student's
-- active modules. `studio_courses` itself isn't defined in this file (see
-- app/api/studio/courses/route.ts's header comment — it's created/migrated
-- manually in the Supabase SQL editor), so run this directly too.
-- ---------------------------------------------------------------------------
alter table studio_courses add column if not exists flashcard_queue jsonb not null default '[]';

-- ---------------------------------------------------------------------------
-- Web Push subscriptions — a JSONB array of standard PushSubscription
-- objects ({endpoint, keys: {p256dh, auth}}) on the student's own `profiles`
-- row, one entry per browser/device they've opted in from. Deliberately a
-- column on `profiles`, not a new table — see flashcard_active_module_ids
-- just above for why: a fresh table's PostgREST schema-cache entry never
-- picked up in this project even after a manual cache reload, while
-- `profiles` has repeatedly proven to work the moment a new column is added
-- to it. Written by app/api/push/subscribe & unsubscribe, read by
-- app/api/push/dispatch & dispatch-self (lib/push/dispatch.ts).
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists push_subscriptions jsonb not null default '[]';

-- ---------------------------------------------------------------------------
-- "Points Faibles & Plan de Remédiation" — same safe, proven pattern as
-- flashcard_active_module_ids just above (a plain array column on the
-- student's own `profiles` row, never a join table or a column on the
-- shared `curriculum_modules`). Deliberately does NOT reuse the existing
-- `weakness_radar` SQL function above — that one joins
-- qcm_attempts -> courses -> the ad-hoc `modules` table, which structurally
-- never matches a Studio course's "studio-course-{id}" slug, so it always
-- returns zero rows for anyone using only Studio courses. This feature's
-- own aggregation (app/api/study/remediation-plan/generate/route.ts) reuses
-- `course_weak_qcms` instead — that one is a pure `qcm_attempts` filter with
-- no join, and already works correctly for Studio course slugs (confirmed
-- via CourseStatsModal's existing usage).
--
-- weakness_remediation_plan/generated_at cache the AI's last analysis so
-- opening /study never re-spends tokens by itself — only an explicit
-- "Générer"/"Régénérer" click in WeaknessRemediationPlan.tsx does.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists weakness_active_module_ids integer[] not null default '{}';
alter table profiles add column if not exists weakness_remediation_plan jsonb;
alter table profiles add column if not exists weakness_remediation_generated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Native file viewer for "Afficher le cours" — the original uploaded
-- document's public Supabase Storage URL (bucket "course-sources", see
-- app/api/upload/route.ts's uploadSourceFile), so the workspace can render
-- the REAL PDF/DOCX/PPTX (components/course/workspace/FileViewerModal.tsx)
-- instead of only the raw extracted text. NULL for courses created from
-- pasted text (no original file) or uploaded before this column existed —
-- FileViewerModal falls back to raw_text in both cases.
-- ---------------------------------------------------------------------------
alter table studio_courses add column if not exists source_file_url text;

-- ---------------------------------------------------------------------------
-- "Mes notes" — free-standing student notes. Table `user_notes` (id,
-- user_id, title, content, created_at) was created manually in the Supabase
-- SQL editor, same convention as `studio_courses` (see
-- app/api/studio/courses/route.ts's header comment).
--
-- `module_id` — added for the "aggregate notes by module" behavior: a text
-- selection captured via TextSelectionToolbar's "Add Note" from inside a
-- curriculum module's workspace (app/dashboard/module/[id]/page.tsx, the
-- only surface with a real curriculum_module_id — the legacy per-slug demo
-- pipeline has no such id) appends into ONE note per module instead of
-- creating a new row every time, keyed by this column. Deliberately
-- `integer` referencing curriculum_modules(id), NOT text — every other
-- "module id" column in this schema (e.g. studio_courses.curriculum_module_id)
-- is an integer FK to the same table, and there is no natural text
-- identifier for a module here; a text column would just be an
-- inconsistent, unjoinable copy of the same integer id as a string. NULL
-- for notes created any other way (the Studio's own note editor, a plain
-- "Nouvelle note" from /dashboard/notes, or a capture from the legacy demo
-- pipeline) — those keep the original "always a new row" behavior.
-- ---------------------------------------------------------------------------
alter table user_notes add column if not exists module_id integer references curriculum_modules (id) on delete set null;

-- ---------------------------------------------------------------------------
-- "Résumé global du module" — one AI-generated synthesis PER module, keyed
-- by module id (as a string — JSON object keys always are) inside a single
-- jsonb map on the student's own `profiles` row. Same "extend `profiles`
-- with a new column" pattern as flashcard_active_module_ids/weakness_*
-- above, for the same reason: a brand-new table's PostgREST schema-cache
-- entry has never reliably been picked up in this project. Written by
-- POST app/api/modules/[id]/global-summary, read (cached, no AI call) by
-- its own GET.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists module_global_summaries jsonb not null default '{}';

-- ---------------------------------------------------------------------------
-- Seed — Médecine 2ème et 3ème année, exactement comme spécifié. Chaque
-- insertion est protégée par un NOT EXISTS contre les index uniques
-- ci-dessus : ce bloc est idempotent, le ré-exécuter ne duplique jamais rien.
-- ---------------------------------------------------------------------------
do $$
declare
  v_specialty_id bigint;
  v_year_id bigint;
  v_unit_id bigint;
begin
  insert into curriculum_specialties (name)
    select 'Médecine' where not exists (select 1 from curriculum_specialties where name = 'Médecine');
  select id into v_specialty_id from curriculum_specialties where name = 'Médecine';

  -- ============================= 2ème Année =============================
  insert into curriculum_academic_years (specialty_id, level, name)
    select v_specialty_id, 2, '2ème Année Médecine'
    where not exists (select 1 from curriculum_academic_years where specialty_id = v_specialty_id and level = 2);
  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 2;

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Unité Cardio-respiratoire', 1
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Cardio-respiratoire');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Cardio-respiratoire';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Anatomie/Respiratoire',1), ('Histologie',2), ('Physiologie',3), ('Biophysique',4), ('Secourisme',5)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Unité Appareil digestif', 2
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Appareil digestif');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Appareil digestif';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Anatomie',1), ('Histologie',2), ('Physiologie',3), ('Biochimie',4)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Unité Appareil Urinaire', 3
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Appareil Urinaire');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Appareil Urinaire';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Anatomie',1), ('Histologie',2), ('Physiologie',3), ('Biochimie',4)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Unité Appareil endocrinien', 4
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Appareil endocrinien');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Appareil endocrinien';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Anatomie',1), ('Histologie',2), ('Physiologie',3), ('Biochimie',4)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Unité Système nerveux et Organes des sens', 5
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Système nerveux et Organes des sens');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Unité Système nerveux et Organes des sens';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Anatomie',1), ('Histologie',2), ('Physiologie',3), ('Biophysique',4)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Immunologie',1), ('Génétique',2)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  -- ============================= 3ème Année =============================
  insert into curriculum_academic_years (specialty_id, level, name)
    select v_specialty_id, 3, '3ème Année Médecine'
    where not exists (select 1 from curriculum_academic_years where specialty_id = v_specialty_id and level = 3);
  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 3;

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Uei 01 : Appareil cardiovasculaire et respiratoire', 1
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Uei 01 : Appareil cardiovasculaire et respiratoire');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Uei 01 : Appareil cardiovasculaire et respiratoire';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Psychologie',1), ('Sémiologie',2), ('Radiologie',3), ('Physiopathologie',4), ('Biochimie',5)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Uei 02 : Appareil neurologique, locomoteur, cutané', 2
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Uei 02 : Appareil neurologique, locomoteur, cutané');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Uei 02 : Appareil neurologique, locomoteur, cutané';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Sémiologie',1), ('Radiologie',2), ('Physiopathologie',3), ('Biochimie',4)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Uei 03 : Appareil endocrinien et Urinaire', 3
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Uei 03 : Appareil endocrinien et Urinaire');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Uei 03 : Appareil endocrinien et Urinaire';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Sémiologie',1), ('Radiologie',2), ('Physiopathologie',3), ('Biochimie',4)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_teaching_units (year_id, title, unit_order)
    select v_year_id, 'Uei 04 : Appareil digestif et Organes hématopoïétiques', 4
    where not exists (select 1 from curriculum_teaching_units where year_id = v_year_id and title = 'Uei 04 : Appareil digestif et Organes hématopoïétiques');
  select id into v_unit_id from curriculum_teaching_units where year_id = v_year_id and title = 'Uei 04 : Appareil digestif et Organes hématopoïétiques';
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, v_unit_id, m.title, m.ord
    from (values ('Sémiologie',1), ('Radiologie',2), ('Physiopathologie',3), ('Biochimie',4)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where teaching_unit_id = v_unit_id and title = m.title);

  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Module Indépendant 1',1), ('Module Indépendant 2',2), ('Module Indépendant 3',3), ('Module Indépendant 4',4), ('Module Indépendant 5',5)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  -- ==================== Années restantes de Médecine (1,4,5,6) ====================
  -- Créées vides (aucune UE/module réel encore fourni) pour que
  -- l'architecture "supporte" déjà toutes les années, comme demandé.
  insert into curriculum_academic_years (specialty_id, level, name)
    select v_specialty_id, y.level, y.label || ' Année Médecine'
    from (values (1,'1ère'), (4,'4ème'), (5,'5ème'), (6,'6ème')) as y(level, label)
    where not exists (select 1 from curriculum_academic_years where specialty_id = v_specialty_id and level = y.level);
end $$;

-- ---------------------------------------------------------------------------
-- Pharmacie et Dentaire : uniquement les spécialités + leurs 6 années
-- vides, pour que l'architecture supporte déjà toutes les filières — aucun
-- contenu réel (UE/modules) n'a été fourni pour elles dans le cahier des
-- charges.
-- ---------------------------------------------------------------------------
do $$
declare
  v_specialty_id bigint;
begin
  insert into curriculum_specialties (name) select 'Pharmacie' where not exists (select 1 from curriculum_specialties where name = 'Pharmacie');
  select id into v_specialty_id from curriculum_specialties where name = 'Pharmacie';
  insert into curriculum_academic_years (specialty_id, level, name)
    select v_specialty_id, y.level, y.label || ' Année Pharmacie'
    from (values (1,'1ère'), (2,'2ème'), (3,'3ème'), (4,'4ème'), (5,'5ème'), (6,'6ème')) as y(level, label)
    where not exists (select 1 from curriculum_academic_years where specialty_id = v_specialty_id and level = y.level);

  insert into curriculum_specialties (name) select 'Dentaire' where not exists (select 1 from curriculum_specialties where name = 'Dentaire');
  select id into v_specialty_id from curriculum_specialties where name = 'Dentaire';
  insert into curriculum_academic_years (specialty_id, level, name)
    select v_specialty_id, y.level, y.label || ' Année Dentaire'
    from (values (1,'1ère'), (2,'2ème'), (3,'3ème'), (4,'4ème'), (5,'5ème'), (6,'6ème')) as y(level, label)
    where not exists (select 1 from curriculum_academic_years where specialty_id = v_specialty_id and level = y.level);
end $$;

-- ===========================================================================
-- Lien profil <-> cursus réel. `profiles` ne stockait jusqu'ici que
-- trial_ends_at — specialty/année vivaient uniquement dans
-- auth.users.user_metadata, sous forme de chaînes libres ("medicine",
-- "2") totalement déconnectées de curriculum_specialties/
-- curriculum_academic_years (lib/constants.ts générait une liste d'années
-- 100% côté client, jamais lue depuis Supabase). C'est la cause racine du
-- bug : rien dans le profil ne référence jamais une vraie ligne
-- curriculum_academic_years, donc le Dashboard n'a jamais eu de quoi savoir
-- quelle année afficher. Ces deux colonnes remplacent ce mécanisme par un
-- vrai lien relationnel. Nullable : un profil peut légitimement n'avoir
-- encore rien choisi (juste après inscription).
-- ===========================================================================
alter table profiles add column if not exists specialty_id bigint references curriculum_specialties (id) on delete set null;
alter table profiles add column if not exists academic_year_id bigint references curriculum_academic_years (id) on delete set null;

create index if not exists profiles_academic_year_id_idx on profiles (academic_year_id);

-- Pas de policy UPDATE ajoutée ici à dessein : l'écriture passe exclusivement
-- par app/api/profile/route.ts (PATCH), qui vérifie l'utilisateur connecté
-- côté serveur puis écrit via le client service-role (getSupabaseAdmin),
-- lequel court-circuite RLS. Ouvrir une policy UPDATE publique sur
-- `profiles` pour un accès direct depuis le client n'apporterait rien de
-- plus et élargirait la surface d'attaque pour rien.

-- ===========================================================================
-- Programme réel exhaustif — Médecine / Médecine Dentaire / Pharmacie,
-- toutes années. Remplace les placeholders "Module Indépendant N" de
-- Médecine 3ème année par les vrais modules, ajoute le niveau Internat
-- (7ème année Médecine, 6ème année Dentaire/Pharmacie), et insère
-- exhaustivement tous les modules indépendants listés pour chaque
-- filière/année. Entièrement idempotent (NOT EXISTS partout) : sûr à
-- ré-exécuter. Noms de colonnes alignés sur le schéma réellement déployé
-- (unit_order/module_order — voir la note plus haut sur ce fichier).
-- ===========================================================================

-- A. Nettoyage strict : supprime uniquement les anciens placeholders. Aucun
-- module réel de la liste ci-dessous ne commence par "Module" — ce filtre ne
-- peut donc jamais toucher un UE ni un sous-module déjà en place.
delete from curriculum_modules where title like 'Module Indépendant %' or title like 'Module %';

-- B. Niveaux Internat. Dentaire/Pharmacie ont déjà leurs 6 années depuis la
-- première migration curriculum — ces deux inserts sont des no-op protégés
-- par NOT EXISTS, gardés ici pour que ce script reste une preuve autonome
-- et complète des niveaux requis. Seul le niveau 7 Médecine est réellement
-- nouveau.
do $$
declare
  v_specialty_id bigint;
begin
  select id into v_specialty_id from curriculum_specialties where name = 'Médecine';
  insert into curriculum_academic_years (specialty_id, level, name)
    select v_specialty_id, 7, '7ème année'
    where not exists (select 1 from curriculum_academic_years where specialty_id = v_specialty_id and level = 7);

  select id into v_specialty_id from curriculum_specialties where name = 'Médecine Dentaire';
  insert into curriculum_academic_years (specialty_id, level, name)
    select v_specialty_id, 6, '6ème année'
    where not exists (select 1 from curriculum_academic_years where specialty_id = v_specialty_id and level = 6);

  select id into v_specialty_id from curriculum_specialties where name = 'Pharmacie';
  insert into curriculum_academic_years (specialty_id, level, name)
    select v_specialty_id, 6, '6ème année'
    where not exists (select 1 from curriculum_academic_years where specialty_id = v_specialty_id and level = 6);
end $$;

-- C. Modules indépendants exhaustifs — Médecine (3ème à 7ème année).
-- teaching_unit_id est explicitement NULL partout : ce sont tous des modules
-- indépendants, jamais des sous-modules d'UE. La 2ème année (5 UE +
-- Immunologie/Génétique) et les UE/sous-modules de la 3ème année ne sont
-- pas touchés par ce bloc.
do $$
declare
  v_specialty_id bigint;
  v_year_id bigint;
begin
  select id into v_specialty_id from curriculum_specialties where name = 'Médecine';

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 3;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Anatomie pathologique',1), ('Immunologie',2), ('Parasitologie',3), ('Microbiologie',4), ('Pharmacologie',5)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 4;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Cardiologie',1), ('Hépato-Gastro-Entérologie',2), ('Hématologie',3), ('Infectiologie',4), ('Neurologie',5), ('Pneumologie',6)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 5;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Endocrinologie',1), ('Gynécologie',2), ('Orthopédie',3), ('Pédiatrie',4), ('Psychiatrie',5), ('Rhumatologie',6), ('Urologie-Néphrologie',7)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 6;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Dermatologie',1), ('Ophtalmologie',2), ('ORL',3), ('Épidémiologie',4), ('Urgences',5),
      ('Médecine légale',6), ('Psychologie médicale',7), ('Thérapeutique',8), ('Médecine de travail',9),
      ('Économie de la santé',10), ('Droit médical',11)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 7;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Stage Internat',1)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);
end $$;

-- D. Modules indépendants exhaustifs — Médecine Dentaire (1ère à 6ème année).
do $$
declare
  v_specialty_id bigint;
  v_year_id bigint;
begin
  select id into v_specialty_id from curriculum_specialties where name = 'Médecine Dentaire';

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 1;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Anatomie générale',1), ('Physiologie générale',2), ('Histologie/embryologie',3), ('Génétique',4),
      ('Biochimie',5), ('Physique',6), ('Biophysique',7), ('Biomathématiques/Statistiques',8), ('Chimie',9),
      ('Santé sociale et sciences humaines',10), ('Anglais',11), ('Français',12)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 2;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Prothèse',1), ('Odontologie Conservatrice/Endodontie',2), ('Parodontologie',3), ('Pathologie et Thérapeutique',4),
      ('Orthopédie Dento-Faciale',5), ('Anatomie Dentaire',6), ('Anatomie/Histologie',7), ('Physiologie/Anatomie Pathologique',8)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 3;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Pathologie et Chirurgie Buccale',1), ('Prothèse',2), ('Odontologie Conservatrice/Endodontie',3),
      ('Orthopédie Dento-Faciale',4), ('Parodontologie',5)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 4;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Prothèse',1), ('Odontologie conservatrice/Endodontie',2), ('Pathologie et Chirurgie Buccales',3), ('Pathologie Médicale',4)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 5;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Prothèse',1), ('Odontologie Conservatrice/Endodontie',2), ('Parodontologie',3), ('Implantologie',4), ('Epidémiologie',5)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 6;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Stage Internat',1)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);
end $$;

-- E. Modules indépendants exhaustifs — Pharmacie (1ère à 6ème année).
do $$
declare
  v_specialty_id bigint;
  v_year_id bigint;
begin
  select id into v_specialty_id from curriculum_specialties where name = 'Pharmacie';

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 1;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Biologie Cellulaire',1), ('Chimie Générale',2), ('Chimie Organique',3), ('Biologie Végétale/Botanique',4),
      ('Physique/Physique Pharmaceutique',5), ('Biomathématiques/Biostatistiques',6), ('Anatomie',7), ('Physiologie',8),
      ('Histoire de la Pharmacie',9), ('Français/Anglais/Terminologie Médicale',10)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 2;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Biochimie',1), ('Chimie minérale pharmaceutique',2), ('Chimie analytique fondamentale',3), ('Biophysique',4),
      ('Botanique pharmaceutique',5), ('Génétique',6), ('Physiopathologie',7), ('Culture générale',8)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 3;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Chimie thérapeutique',1), ('Pharmacie galénique',2), ('Chimie analytique',3), ('Pharmacognosie',4),
      ('Pharmacologie',5), ('Sémiologie médicale',6)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 4;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Parasitologie',1), ('Immunologie',2), ('Hémobiologie',3), ('Biochimie Clinique',4), ('Microbiologie',5)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 5;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Toxicologie',1), ('Hydro-Bromatologie',2), ('Epidémiologie et Recherche',3), ('Droit Pharmaceutique',4),
      ('Gestion Pharmaceutique',5), ('Pharmacie Hospitalière',6), ('Pharmacie Clinique',7), ('Pharmacie Industrielle',8)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);

  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 6;
  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values ('Stage Internat',1)) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);
end $$;

-- ---------------------------------------------------------------------------
-- Modules manquants — Médecine 1ère année (level = 1). Omis de la migration
-- précédente ; insérés ici en modules indépendants (teaching_unit_id null),
-- idempotent via NOT EXISTS comme le reste de ce fichier.
-- ---------------------------------------------------------------------------
do $$
declare
  v_specialty_id bigint;
  v_year_id bigint;
begin
  select id into v_specialty_id from curriculum_specialties where name = 'Médecine';
  select id into v_year_id from curriculum_academic_years where specialty_id = v_specialty_id and level = 1;

  insert into curriculum_modules (year_id, teaching_unit_id, title, module_order)
    select v_year_id, null, m.title, m.ord
    from (values
      ('Anatomie',1), ('Cytologie',2), ('Histologie',3), ('Physiologie',4), ('Embryologie',5),
      ('Biophysique',6), ('Biochimie',7), ('Chimie',8), ('Informatique',9), ('Biostatistiques',10), ('S.S.H',11)
    ) as m(title, ord)
    where not exists (select 1 from curriculum_modules where year_id = v_year_id and teaching_unit_id is null and title = m.title);
end $$;
