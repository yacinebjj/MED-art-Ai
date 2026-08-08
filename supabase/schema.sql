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
