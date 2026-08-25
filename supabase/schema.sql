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

-- EXPLICIT zero-trust policy, replacing reliance on the file-header comment
-- above ("RLS enabled with no public policies") as the only documentation
-- of intent. RLS-enabled-with-zero-policies already denies all anon/
-- authenticated access by default — this makes that a per-table, reviewed
-- decision instead of an inferred global rule, so a future policy added
-- elsewhere in this file can't accidentally reopen this table without
-- someone having to consciously replace this one first. Found during a
-- security audit — every access path already goes through the service-role
-- client (bypasses RLS), so this changes no real behavior.
drop policy if exists "Deny all client access" on courses_cache;
create policy "Deny all client access" on courses_cache for all using (false);

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

-- EXPLICIT zero-trust policy — see courses_cache's identical comment above
-- for why this is written out per-table rather than left as an inferred
-- global rule. `subscriptions` holds plan/email/usage-counter data, making
-- this one of the higher-value tables to have this documented explicitly.
drop policy if exists "Deny all client access" on subscriptions;
create policy "Deny all client access" on subscriptions for all using (false);

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

-- Free-form chat quota (the open assistant question box) — a THIRD, separate
-- counter from highlight_messages_used above: same monthly rollover clock
-- (generations_period_start, via lib/subscription.ts's ensureFreshUsagePeriod),
-- but its own cap per plan (Plan.chatMessageCap in lib/pricing.ts), because
-- free-form chat and highlight quick-actions are different UI surfaces with
-- different usage patterns. Added after discovering, during a cost stress
-- test, that free-form chat was the one AI-cost surface with neither a cache
-- nor a quota — see app/api/courses/chat/route.ts's canSendChatMessage call.
alter table subscriptions add column if not exists chat_messages_used integer not null default 0;

-- Flashcard, weak-point-remediation, and daily-chat quotas — closes the
-- three remaining unmetered AI-cost surfaces found during a cost audit (see
-- app/api/flashcards/generate and app/api/study/remediation-plan/generate,
-- neither of which checked any quota before this; and free-form chat, which
-- previously had only a monthly cap with no daily ceiling).
alter table subscriptions add column if not exists flashcards_used integer not null default 0;
alter table subscriptions add column if not exists remediation_used integer not null default 0;
-- Deliberately its OWN 24h clock, not generations_period_start — a daily cap
-- must reset every day regardless of where a student is in their monthly
-- billing cycle. See lib/subscription.ts's ensureFreshDailyChatPeriod.
alter table subscriptions add column if not exists daily_chat_messages_used integer not null default 0;
alter table subscriptions add column if not exists daily_chat_reset_at timestamptz;

create or replace function increment_flashcards_used(p_user_id text, p_count integer)
returns void
language sql
as $$
  update subscriptions set flashcards_used = flashcards_used + p_count, updated_at = now()
  where user_id = p_user_id;
$$;

create or replace function increment_remediation_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set remediation_used = remediation_used + 1, updated_at = now()
  where user_id = p_user_id;
$$;

create or replace function increment_daily_chat_messages_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set daily_chat_messages_used = daily_chat_messages_used + 1, updated_at = now()
  where user_id = p_user_id;
$$;

create or replace function increment_chat_messages_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set chat_messages_used = chat_messages_used + 1, updated_at = now()
  where user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- Atomic reserve/refund functions — replace the old "read used, compare to
-- cap in application code, increment later" pattern (canGenerate() then a
-- separate recordGeneration() call after the OpenRouter response), which had
-- a real TOCTOU race: N concurrent requests inside one rate-limit window
-- could all read the same pre-increment `used`, all pass the check, and all
-- bill a real OpenRouter call before any of them wrote back — landing `used`
-- at up to cap + N instead of stopping at cap. Found during a security audit.
--
-- Each `reserve_*` function does the check AND the increment in ONE
-- statement. Postgres serializes concurrent UPDATEs to the same row (the
-- second waits for the first's transaction to finish, then re-evaluates its
-- own WHERE clause against the now-committed value), so two callers can
-- never both slip through — one gets the new value back, the other gets
-- NULL (no row matched `used < cap`) and must not proceed.
--
-- The reservation happens BEFORE the OpenRouter call, not after — so a
-- `refund_*` function un-does it if the call then fails, preserving the
-- existing "a failed generation shouldn't cost you a quota unit" guarantee
-- without reopening the race.
-- ---------------------------------------------------------------------------

create or replace function reserve_generations_used(p_user_id text, p_cap integer)
returns integer
language sql
as $$
  update subscriptions set generations_used = generations_used + 1, updated_at = now()
  where user_id = p_user_id and generations_used < p_cap
  returning generations_used;
$$;

create or replace function refund_generations_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set generations_used = greatest(generations_used - 1, 0), updated_at = now()
  where user_id = p_user_id;
$$;

-- Not explicitly requested in the remediation directive (which named
-- canGenerate/canSendChatMessage/canSendChatMessageDaily/flashcards) but the
-- exact same race exists here too — canSendHighlightMessage used the same
-- read-then-write checkQuota() helper. Fixed for real completeness rather
-- than leaving one of the five gated resources exploitable.
create or replace function reserve_highlight_messages_used(p_user_id text, p_cap integer)
returns integer
language sql
as $$
  update subscriptions set highlight_messages_used = highlight_messages_used + 1, updated_at = now()
  where user_id = p_user_id and highlight_messages_used < p_cap
  returning highlight_messages_used;
$$;

create or replace function refund_highlight_messages_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set highlight_messages_used = greatest(highlight_messages_used - 1, 0), updated_at = now()
  where user_id = p_user_id;
$$;

create or replace function reserve_chat_messages_used(p_user_id text, p_cap integer)
returns integer
language sql
as $$
  update subscriptions set chat_messages_used = chat_messages_used + 1, updated_at = now()
  where user_id = p_user_id and chat_messages_used < p_cap
  returning chat_messages_used;
$$;

create or replace function refund_chat_messages_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set chat_messages_used = greatest(chat_messages_used - 1, 0), updated_at = now()
  where user_id = p_user_id;
$$;

-- No refund function for the daily counter: it gates cache hits too (see
-- app/api/courses/chat/route.ts), which never fail after being counted, and
-- the one real-generation path that DOES fail also fails BEFORE this ever
-- gets reserved in that flow — see the route's own ordering.
create or replace function reserve_daily_chat_messages_used(p_user_id text, p_cap integer)
returns integer
language sql
as $$
  update subscriptions set daily_chat_messages_used = daily_chat_messages_used + 1, updated_at = now()
  where user_id = p_user_id and daily_chat_messages_used < p_cap
  returning daily_chat_messages_used;
$$;

create or replace function reserve_remediation_used(p_user_id text, p_cap integer)
returns integer
language sql
as $$
  update subscriptions set remediation_used = remediation_used + 1, updated_at = now()
  where user_id = p_user_id and remediation_used < p_cap
  returning remediation_used;
$$;

create or replace function refund_remediation_used(p_user_id text)
returns void
language sql
as $$
  update subscriptions set remediation_used = greatest(remediation_used - 1, 0), updated_at = now()
  where user_id = p_user_id;
$$;

-- Flashcards reserve a VARIABLE count (a batch, clamped to whatever quota
-- remains) rather than a fixed 1 — needs an explicit row lock (SELECT ...
-- FOR UPDATE) instead of a single UPDATE...WHERE, since the "how much do I
-- have room for" computation depends on reading the current value first.
-- The row lock is what closes the race: a second concurrent caller blocks
-- on SELECT ... FOR UPDATE until the first transaction commits, then reads
-- the already-updated value. Returns how many of p_requested were actually
-- granted (0..p_requested) — the caller must clamp its batch to this.
create or replace function reserve_flashcards_used(p_user_id text, p_requested integer, p_cap integer)
returns integer
language plpgsql
as $$
declare
  v_current integer;
  v_allowed integer;
begin
  select flashcards_used into v_current from subscriptions where user_id = p_user_id for update;
  if v_current is null then
    return p_requested;
  end if;

  v_allowed := greatest(least(p_requested, p_cap - v_current), 0);
  if v_allowed > 0 then
    update subscriptions set flashcards_used = flashcards_used + v_allowed, updated_at = now()
    where user_id = p_user_id;
  end if;

  return v_allowed;
end;
$$;

create or replace function refund_flashcards_used(p_user_id text, p_count integer)
returns void
language sql
as $$
  update subscriptions set flashcards_used = greatest(flashcards_used - p_count, 0), updated_at = now()
  where user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- DEFENSE IN DEPTH: none of the 11 reserve_*/refund_* functions above (nor
-- the 6 legacy increment_* ones they replaced in application code, kept
-- here since old rows may still reference them and dropping them is a
-- separate decision) are `SECURITY DEFINER` — they run as the CALLER. Since
-- Postgres grants EXECUTE on new functions to PUBLIC by default and no
-- REVOKE ever existed, any authenticated student could call any of these
-- directly via PostgREST's `/rpc/...` with a forged `p_cap`. Today this is
-- safe ONLY because `subscriptions` carries a `for all using (false)` deny-
-- all policy (see its own comment above) — a non-service-role caller's
-- internal `UPDATE ... WHERE user_id = p_user_id` matches zero rows and the
-- function returns NULL/no-ops, not because these functions themselves
-- refuse the caller. That's correct today, but it's a non-obvious
-- protection — nothing under `security review` on just these functions in
-- isolation would show they're safe. Explicit REVOKE makes the safety
-- independent of that interaction, so a future, unrelated change to
-- subscriptions' RLS can't silently reopen these. Found during a security
-- audit's own verification pass (which confirmed no live exploit exists
-- today) — this closes the "why is this safe" question for good rather
-- than leaving it resting on one correct-but-easy-to-miss fact.
revoke execute on function reserve_generations_used(text, integer) from anon, authenticated;
revoke execute on function refund_generations_used(text) from anon, authenticated;
revoke execute on function reserve_highlight_messages_used(text, integer) from anon, authenticated;
revoke execute on function refund_highlight_messages_used(text) from anon, authenticated;
revoke execute on function reserve_chat_messages_used(text, integer) from anon, authenticated;
revoke execute on function refund_chat_messages_used(text) from anon, authenticated;
revoke execute on function reserve_daily_chat_messages_used(text, integer) from anon, authenticated;
revoke execute on function reserve_remediation_used(text, integer) from anon, authenticated;
revoke execute on function refund_remediation_used(text) from anon, authenticated;
revoke execute on function reserve_flashcards_used(text, integer, integer) from anon, authenticated;
revoke execute on function refund_flashcards_used(text, integer) from anon, authenticated;
revoke execute on function increment_generations_used(text) from anon, authenticated;
revoke execute on function increment_highlight_messages_used(text) from anon, authenticated;
revoke execute on function increment_chat_messages_used(text) from anon, authenticated;
revoke execute on function increment_daily_chat_messages_used(text) from anon, authenticated;
revoke execute on function increment_remediation_used(text) from anon, authenticated;
revoke execute on function increment_flashcards_used(text, integer) from anon, authenticated;

-- Backfill: every account created before this migration (or whose signup
-- trigger hiccupped) gets an implicit Freemium row too, exactly like the
-- profiles backfill below. Accounts that already have a row (paid or not)
-- are left untouched by the ON CONFLICT.
insert into subscriptions (user_id, email, plan, status, period_start, generations_used, generations_period_start, highlight_messages_used, chat_messages_used)
select id::text, email, 'freemium', 'active', now(), 0, now(), 0, 0 from auth.users
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

-- EXPLICIT zero-trust policy — see courses_cache's identical comment further
-- up for why. `payments` holds billing amounts and Chargily's raw webhook
-- payload — a real one to have this documented, not just inferred.
drop policy if exists "Deny all client access" on payments;
create policy "Deny all client access" on payments for all using (false);

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
  insert into public.subscriptions (user_id, email, plan, status, period_start, generations_used, generations_period_start, highlight_messages_used, chat_messages_used)
  values (new.id::text, new.email, 'freemium', 'active', now(), 0, now(), 0, 0)
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

-- ---------------------------------------------------------------------------
-- SECURITY FIX: `modules` was documented (see the comment further down, near
-- curriculum_modules, explaining why THAT table is named differently) as
-- "le dossier PERSONNEL et ad-hoc qu'un étudiant crée lui-même via 'Ajouter
-- à un module'" — but the actual table/API never enforced that: `name` was
-- globally unique with zero user scoping, `app/api/modules/route.ts` did an
-- unscoped SELECT/INSERT, and RLS was enabled with ZERO policies (meaning,
-- under RLS, unscoped anon/authenticated access was already denied by
-- default — but every real read/write went through the service-role client,
-- which bypasses RLS entirely, so the app-level lack of scoping was the
-- actual live hole). Two different students both creating a "Cardiologie"
-- folder collided into the SAME shared row, mixing their courses together.
-- Found during a security audit.
--
-- MIGRATION HAZARD, read before running: this table may already have real
-- rows with no owner (created before this fix existed). Adding `user_id`
-- as NOT NULL would make this ALTER TABLE fail outright against a non-empty
-- table with no sensible default to backfill (there is no way to know who
-- "owns" an existing shared row — the data model never tracked that). This
-- adds the column NULLABLE instead: legacy rows keep user_id = NULL, and
-- the RLS policies below (auth.uid() = user_id) mean those legacy rows
-- become invisible to EVERYONE going forward (auth.uid() never equals
-- NULL) — they don't leak, but they also don't silently get reassigned to
-- whoever happens to look first. This is a real behavior change worth a
-- deliberate decision (delete the orphaned rows, or manually assign real
-- owners) rather than something to script blindly.
alter table modules add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Replaces the old bare `unique (name)` (module.name is unique(name) at
-- table-create time above; if that constraint still exists in a live
-- database, drop it manually before relying on this one) — two different
-- students must be able to both have a "Cardiologie" folder without
-- colliding into the same row.
drop index if exists modules_name_key;
alter table modules drop constraint if exists modules_name_key;
create unique index if not exists modules_user_id_name_uidx on modules (user_id, name);

drop policy if exists "Users manage their own modules" on modules;
create policy "Users manage their own modules" on modules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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

-- EXPLICIT zero-trust policy — same pattern as courses_cache/subscriptions/
-- payments/semantic_cache/etc. further up. RLS-enabled-with-zero-policies
-- already denies all anon/authenticated access by default, so this changes
-- no real behavior — it's the one table the original hardening pass missed
-- giving a documented, reviewed decision to, unlike its seven siblings.
-- Every real read/write goes through app/api/courses/slug/[slug]/route.ts's
-- service-role client, which bypasses this entirely. Found during a
-- follow-up security audit.
drop policy if exists "Deny all client access" on courses;
create policy "Deny all client access" on courses for all using (false);

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

-- EXPLICIT zero-trust policy — see courses_cache's identical comment further
-- up for why. (Also correcting a naming mismatch from an earlier directive:
-- this is `semantic_cache`, not `course_faq_cache` — no such table exists in
-- this codebase; renaming a working table for no functional reason was
-- deliberately not done, see the earlier RAG-audit turn.)
drop policy if exists "Deny all client access" on semantic_cache;
create policy "Deny all client access" on semantic_cache for all using (false);

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

-- EXPLICIT zero-trust policy — see courses_cache's identical comment further
-- up for why.
drop policy if exists "Deny all client access" on course_source_chunks;
create policy "Deny all client access" on course_source_chunks for all using (false);

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

-- EXPLICIT zero-trust policy — see courses_cache's identical comment further
-- up for why.
drop policy if exists "Deny all client access" on course_explication_chapters;
create policy "Deny all client access" on course_explication_chapters for all using (false);

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

-- EXPLICIT zero-trust policy — see courses_cache's identical comment further
-- up for why.
drop policy if exists "Deny all client access" on course_chunks;
create policy "Deny all client access" on course_chunks for all using (false);

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
-- studio_courses: a student's own AI-generated courses (uploaded PDF/DOCX/
-- pasted text -> Studio's Explication/Résumé/Cas Clinique/QCM/Exemples
-- tiles). Was NEVER defined in this file — created/migrated by hand in the
-- Supabase SQL editor since this table's introduction, per
-- app/api/studio/courses/route.ts's own header comment — meaning until now
-- there was no versioned source of truth for it at all, and no way to
-- confirm RLS was ever actually enabled on the single most sensitive table
-- in this product. Found during a security audit.
--
-- Columns and types below were reverse-engineered from EVERY real call site
-- across 10 files (app/api/studio/*, app/api/flashcards/*,
-- app/api/study/remediation-plan/*, app/api/modules/[id]/global-summary,
-- lib/push/dispatch.ts) — not guessed. `CREATE TABLE IF NOT EXISTS` is a
-- pure no-op if this table already exists in production (Postgres doesn't
-- diff columns on IF NOT EXISTS), so this cannot break or alter a single
-- existing row — worst case, if a type below is wrong, it simply never
-- takes effect. Two residual uncertainties, flagged rather than guessed
-- past: `explication`/`exemples_analogies` are inferred `text` (every code
-- path treats them as plain strings, zod-validated with `z.string().min(50)`
-- — but a jsonb column holding a JSON string would look identical through
-- PostgREST, so this isn't proven); `updated_at` is inferred nullable/
-- defaulted because three routes write it but nothing ever reads it back.
-- Verify both against the real production table before trusting this file
-- as authoritative for either.
-- ---------------------------------------------------------------------------
create table if not exists studio_courses (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- ON DELETE RESTRICT, not CASCADE: curriculum_module_id is NOT NULL, so
  -- SET NULL isn't a clean option without also relaxing that constraint (a
  -- bigger behavior change than fixing the cascade direction). RESTRICT
  -- means deleting a curriculum_modules row that any student has real
  -- content filed under simply FAILS with a clear FK error — protecting
  -- that data — rather than silently cascading it away. See the ALTER
  -- TABLE further down for the fix applied to an already-existing
  -- production table, and its own comment for why this also protects
  -- against the transitive academic_years -> teaching_units -> modules
  -- cascade without needing to touch THOSE cascades at all.
  curriculum_module_id bigint not null references curriculum_modules (id) on delete restrict,
  title text not null,
  raw_text text not null,
  source_file_url text,
  explication text,
  resume jsonb,
  cas_clinique jsonb,
  qcms jsonb,
  exemples_analogies text,
  flashcard_queue jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create index if not exists studio_courses_user_id_idx on studio_courses (user_id);
create index if not exists studio_courses_curriculum_module_id_idx on studio_courses (curriculum_module_id);

alter table studio_courses enable row level security;

drop policy if exists "Users manage their own studio courses" on studio_courses;
create policy "Users manage their own studio courses" on studio_courses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Anki-style Q&A flashcard queue — one array PER COURSE, on `studio_courses`
-- itself, mirroring that table's own `qcms` jsonb column exactly (same
-- table, same proven-working PostgREST pattern, rather than a brand-new
-- table). Each element is `{id, question, answer}`, appended to by
-- app/api/flashcards/generate/route.ts and read by
-- app/api/flashcards/pool/route.ts across every course in the student's
-- active modules. Harmless no-op now that studio_courses is defined above
-- with this same column — kept for whoever's production table predates it.
-- ---------------------------------------------------------------------------
alter table studio_courses add column if not exists flashcard_queue jsonb not null default '[]';

-- ---------------------------------------------------------------------------
-- content_hash: sha256(normalizeText(raw source text)) — the SAME value
-- studio_content_cache already computes internally (lib/content-similarity.ts)
-- to decide whether two students' uploads are "the same course", now also
-- stored directly on the student's own row so app/api/studio/regenerate can
-- key studio_content_variations (below) off it WITHOUT re-fetching or
-- re-hashing raw_text on every regenerate click. Nullable: rows generated
-- before this column existed simply have no variation caching (regenerate
-- falls back to its original always-fresh behavior for them — see that
-- route's own comment).
-- ---------------------------------------------------------------------------
alter table studio_courses add column if not exists content_hash text;
create index if not exists studio_courses_content_hash_idx on studio_courses (content_hash);

-- ---------------------------------------------------------------------------
-- flashcards_content_cache: cross-student cache for the "definitive set"
-- flashcard architecture (replaces per-call random-excerpt sampling — see
-- lib/ai/flashcard-prompts.ts's buildDefinitiveFlashcardSetPrompt and
-- app/api/flashcards/generate/route.ts). Keyed by content_hash of the
-- COURSE'S EXPLICATION TEXT specifically (not raw_text — the definitive set
-- is generated FROM the explication, so that's the text that actually
-- determines its content; a different hash flavor than studio_courses'
-- raw_text-based content_hash above, computed inline where it's used, not
-- worth a dedicated column since it's cheap pure-JS hashing on demand).
-- One row per distinct explication text, ever, platform-wide: student #1
-- studying "Asthme" pays for the generation; students #2-700 studying the
-- byte-identical (or normalized-identical) explication hit this table for
-- $0. Deny-all RLS — every access goes through the service-role client in
-- the route above, exactly like studio_content_cache.
-- ---------------------------------------------------------------------------
create table if not exists flashcards_content_cache (
  content_hash text primary key,
  cards_data jsonb not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz
);

alter table flashcards_content_cache enable row level security;
drop policy if exists "Deny all client access" on flashcards_content_cache;
create policy "Deny all client access" on flashcards_content_cache for all using (false);

create or replace function increment_flashcards_content_cache_hit_count(p_content_hash text)
returns void
language sql
as $$
  update flashcards_content_cache set hit_count = hit_count + 1, last_hit_at = now() where content_hash = p_content_hash;
$$;

-- ---------------------------------------------------------------------------
-- ARCHITECTURAL PIVOT (superseding the original module_synthesis_cache):
-- caching by the SET of selected courses combinatorially exploded — student
-- A selecting {course1,course2,course3} and student B selecting
-- {course1,course2,course3,course4} produce two completely different group
-- hashes despite sharing 3 of 4 courses, so B's request is a 100% cache
-- miss that re-generates content for course1-3 it already had cached under
-- A's key. At realistic 10-20-course selections, near-zero combinations
-- repeat exactly, so the group-level cache barely ever hits in practice.
--
-- course_workspace_cache fixes this by caching at the COURSE level instead
-- of the combination level: one row per (course, generation_type), holding
-- ONLY that single course's modular chunk (never a multi-course narrative).
-- A request for N selected courses becomes: look up all N course-level
-- hashes in one query, generate ONLY the ones missing (in a single batched
-- OpenRouter call covering every miss, not one call per miss), cache each
-- new chunk individually, then stitch the complete set together
-- deterministically server-side. See app/api/workspace/module-synthesis/route.ts.
--
-- HONEST CONSEQUENCE for generation_type = 'summary_chunk': the ORIGINAL
-- "Résumé Global" prompt's #1 rule was "never juxtapose one summary per
-- course after another — find the REAL links between courses." That
-- capability requires seeing multiple courses in one call and is
-- structurally incompatible with course-level-isolated caching (a chunk
-- generated for course X, cached independently of what it's ever combined
-- with, cannot reference course Y). This pivot trades that cross-course
-- synthesis away for near-zero marginal cost at scale — a deliberate
-- product decision, not an oversight; flagged here so the tradeoff is
-- documented in the schema itself, matching this file's convention for
-- every other such decision (studio_content_variations' own comment).
-- ---------------------------------------------------------------------------
drop function if exists increment_module_synthesis_cache_hit_count(text, text);
drop table if exists module_synthesis_cache;

create table if not exists course_workspace_cache (
  course_content_hash text not null,
  generation_type text not null check (generation_type in ('summary_chunk', 'keyword_row_v3')),
  content jsonb not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz,
  primary key (course_content_hash, generation_type)
);

-- MIGRATION HISTORY for the keyword chunk's generation_type — bumped every
-- time the STORED SHAPE changed, never reused, so old-shaped cached rows
-- are simply never looked up again instead of being silently misread:
--   'keyword_row'    -> {concept, term, trap} triples, one small table PER COURSE.
--   'keyword_row_v2' -> a fixed 4-category object, one row in one global table.
--   'keyword_row_v3' -> a DYNAMIC-key object (categories vary per course,
--                       drawn from a preferred shared vocabulary — see
--                       CATEGORY_SUPERSET in lib/ai/module-synthesis-prompts.ts),
--                       each item now "**keyword:** brief explanation" instead
--                       of a bare term. Column set for the final table is the
--                       UNION of every course's own keys, computed at stitch
--                       time — see app/api/workspace/module-synthesis/route.ts.
-- This ALTER is what makes each bump safe on an already-existing production
-- table (CREATE TABLE IF NOT EXISTS above is a no-op there) — same pattern
-- as this file's other ALTER-based constraint fixes.
alter table course_workspace_cache drop constraint if exists course_workspace_cache_generation_type_check;
alter table course_workspace_cache add constraint course_workspace_cache_generation_type_check
  check (generation_type in ('summary_chunk', 'keyword_row_v3'));

alter table course_workspace_cache enable row level security;
drop policy if exists "Deny all client access" on course_workspace_cache;
create policy "Deny all client access" on course_workspace_cache for all using (false);

create or replace function increment_course_workspace_cache_hit_count(p_course_content_hash text, p_generation_type text)
returns void
language sql
as $$
  update course_workspace_cache
  set hit_count = hit_count + 1, last_hit_at = now()
  where course_content_hash = p_course_content_hash and generation_type = p_generation_type;
$$;

-- ---------------------------------------------------------------------------
-- studio_content_variations: caches "Régénérer" output cross-student, capped
-- at 10 variations per (course, section) — see
-- app/api/studio/regenerate/route.ts. Keyed by studio_courses.content_hash
-- (the raw-source-text hash above) + section_key (a DemoSectionId, e.g.
-- "explication"/"qcm" — matching studio_content_cache's own `section`
-- convention, not the "qcm"->"qcms" column-name mapping used elsewhere).
--
-- HONEST PRODUCT TRADEOFF, not hidden: this changes "Régénérer" from
-- unlimited fresh rewrites into "pick one of at most 10 pre-generated
-- alternates, shared across every student on this course/section." A
-- student's 11th+ click on the same section will re-serve an earlier
-- variation verbatim, and two different students clicking "Régénérer" on
-- the same course may eventually see byte-identical "freshly regenerated"
-- content once the pool is exhausted (less likely to be noticed at 10 than
-- at 2, but not impossible). Explicitly specified this way by product
-- direction — flagged here so the tradeoff is documented in the schema
-- itself, not just in a chat message.
--
-- The unique constraint is what makes concurrent-insert safety possible:
-- two students racing to create variation N+1 for the same (content_hash,
-- section_key) will have one INSERT succeed and one hit a 23505 unique-
-- violation, which the route catches and treats as "someone else just
-- created it — re-read and serve what's there" rather than an error.
-- ---------------------------------------------------------------------------
create table if not exists studio_content_variations (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null,
  section_key text not null,
  variation_index integer not null,
  content jsonb not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz,
  unique (content_hash, section_key, variation_index)
);

create index if not exists studio_content_variations_lookup_idx
  on studio_content_variations (content_hash, section_key);

alter table studio_content_variations enable row level security;
drop policy if exists "Deny all client access" on studio_content_variations;
create policy "Deny all client access" on studio_content_variations for all using (false);

create or replace function increment_variation_hit_count(p_variation_id uuid)
returns void
language sql
as $$
  update studio_content_variations set hit_count = hit_count + 1, last_hit_at = now() where id = p_variation_id;
$$;

-- ---------------------------------------------------------------------------
-- module_generated_exams: the real "Générateur d'Examen" persistence layer
-- (app/api/exam/generate/route.ts) — this feature had NO real backend at
-- all before (fully mocked UI: a hardcoded 5-course list shown identically
-- on every module, and a hardcoded 3-question exam). Every generated
-- 40-60 QCM exam is saved here so a student's "Semaine Bloquée" history is
-- permanent, not lost on refresh — same "atomic generate-then-save" policy
-- as Studio's own courseCap-billed generations (never return success
-- without the content already being durably saved first).
--
-- curriculum_module_id is ON DELETE RESTRICT, not CASCADE — same fix
-- already applied to studio_courses.curriculum_module_id (see that column's
-- own comment): admin/seed-managed reference data must never be able to
-- silently wipe a student's real content just because it gets deleted.
-- ---------------------------------------------------------------------------
create table if not exists module_generated_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  curriculum_module_id bigint not null references curriculum_modules (id) on delete restrict,
  selected_courses jsonb not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists module_generated_exams_user_module_idx
  on module_generated_exams (user_id, curriculum_module_id, created_at desc);

alter table module_generated_exams enable row level security;

-- Real client-facing policy (matching studio_courses/user_notes' own
-- convention) even though the actual route uses the service-role client —
-- defense-in-depth, not currently exercised, same reasoning as those two
-- tables' own RLS comments.
drop policy if exists "Users manage their own exams" on module_generated_exams;
create policy "Users manage their own exams" on module_generated_exams
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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

-- SECURITY/DATA-SAFETY FIX: the FK above was originally written as
-- `on delete cascade` — deleting one curriculum_modules row (admin/seed-
-- managed reference data, e.g. to fix a typo'd module name) would silently
-- and permanently delete EVERY enrolled student's studio_courses row filed
-- under it: their generated Explication/Résumé/Cas Clinique/QCM and their
-- entire flashcard_queue, gone with no confirmation step. Found during a
-- security audit. `drop/add constraint` is the only way to change an FK's
-- ON DELETE action in Postgres (ALTER COLUMN can't touch it) — this pair is
-- idempotent and safe to re-run. Postgres constraint auto-naming for an
-- inline `references` clause on this column is
-- `studio_courses_curriculum_module_id_fkey`; if a production table's FK
-- was named differently, this DROP is a silent no-op and the ADD then fails
-- on a duplicate constraint — check `\d studio_courses` if that happens.
alter table studio_courses drop constraint if exists studio_courses_curriculum_module_id_fkey;
alter table studio_courses add constraint studio_courses_curriculum_module_id_fkey
  foreign key (curriculum_module_id) references curriculum_modules (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- user_notes: free-standing student notes ("Mes notes"). Like studio_courses
-- above, this was never defined in this file — created by hand in the
-- Supabase SQL editor, per this section's own pre-existing comment below.
-- Found undocumented during the same security audit that found
-- studio_courses undocumented.
--
-- Reverse-engineered from every real call site in app/api/notes/route.ts and
-- app/api/notes/[id]/route.ts. `CREATE TABLE IF NOT EXISTS` is a pure no-op
-- against an already-existing production table (see studio_courses' own
-- comment above for why this can't break anything). ONE genuine, flagged
-- uncertainty: this table's `id` type was never pinned down anywhere in the
-- application code itself (see app/api/notes/[id]/route.ts's own
-- parseNoteId comment) — every route treats it as an opaque string, never
-- Number()-coerced, specifically so it would keep working regardless of
-- whether the real column is bigint or uuid. `bigint generated by default
-- as identity` is used here only because every OTHER auto-PK table in this
-- schema (studio_courses, courses, curriculum_modules, ...) uses that
-- convention — verify against the real production column before treating
-- this as authoritative.
-- ---------------------------------------------------------------------------
create table if not exists user_notes (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists user_notes_user_id_idx on user_notes (user_id);

alter table user_notes enable row level security;

drop policy if exists "Users manage their own notes" on user_notes;
create policy "Users manage their own notes" on user_notes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- "Mes notes" — free-standing student notes. Table `user_notes` (id,
-- user_id, title, content, created_at) was created manually in the Supabase
-- SQL editor, same convention as `studio_courses` (see
-- app/api/studio/courses/route.ts's header comment). Now defined above too.
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

-- ===========================================================================
-- studio_content_cache: cross-student, content-addressed cache for
-- Studio's deterministic whole-course generations (explication/résumé/
-- cas_clinique/qcm/exemples_analogies — see app/api/studio/generate/route.ts
-- and lib/studio-content-cache.ts for the full design rationale, including
-- exactly why flashcards, the weakness remediation plan, and "Générer un
-- examen" are all deliberately EXCLUDED from this cache).
--
-- Genuinely a NEW, GLOBAL table (no user_id) — unlike every other extension
-- in this file, this can't be a column on an existing per-user table,
-- because the whole point is that the same row is read by many different
-- students. This is a real, working precedent in this project's own
-- history: an earlier `courses_cache` table (see the very top of this
-- file) did exactly this — file-hash-keyed, shared across students — before
-- being retired in favor of the per-user `course_content_cache` when the
-- product pivoted to a per-user-ownership model. This reintroduces the same
-- idea for the Studio pipeline specifically, with two upgrades: content is
-- hashed after NORMALIZATION (not raw file bytes, so formatting-only
-- differences still hit) and a fuzzy MinHash tier catches near-duplicates
-- an exact hash would miss entirely — see lib/content-similarity.ts.
--
-- IMPORTANT — run this in the Supabase SQL editor, then reload PostgREST's
-- schema cache (Settings > API > "Reload schema", or `NOTIFY pgrst, 'reload
-- schema';`) before deploying code that queries it. This project's own
-- history (see the superseded `user_module_flashcards` table further up)
-- shows PostgREST can keep returning "Could not find the table in the
-- schema cache" for a brand-new table until that reload happens, even
-- though the table exists and the query would otherwise be valid.
-- ===========================================================================
create table if not exists studio_content_cache (
  id uuid primary key default gen_random_uuid(),
  section text not null,
  content_hash text not null,
  minhash_signature integer[] not null,
  normalized_length integer not null,
  data jsonb not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz,
  unique (section, content_hash)
);

create index if not exists studio_content_cache_section_idx on studio_content_cache (section);

alter table studio_content_cache enable row level security;

-- SECURITY FIX: this table used to have a blanket "Authenticated read
-- access" policy (`using (auth.role() = 'authenticated')`, no ownership
-- predicate at all) on the theory that it's "shared reference data, same as
-- curriculum_modules's public-read policy." That reasoning doesn't hold up:
-- curriculum_modules holds admin-authored course NAMES; this table holds
-- the full, real generated Explication/Résumé/Cas Clinique/QCM-with-answers
-- content for every course ever cached, across every student. Any signed-in
-- student — including Freemium, capped at 1 course/month — could open
-- devtools, use the public anon key + their own session, and
-- `supabase.from('studio_content_cache').select('*')` to read every cached
-- course on the platform, structurally bypassing courseCap and the entire
-- subscription model. Found during a security audit.
--
-- Every REAL read/write already goes through
-- app/api/studio/generate/route.ts's service-role client
-- (lib/studio-content-cache.ts's getSupabaseAdmin()), which bypasses RLS
-- entirely — confirmed by grep, no component anywhere queries this table
-- with a browser/anon-key client. The permissive policy was never actually
-- exercised by legitimate app code; it only ever provided an attack surface.
-- Deny-all (RLS enabled, zero policies) is therefore not a functionality
-- regression — it closes a hole nothing legitimate was using.
drop policy if exists "Authenticated read access" on studio_content_cache;
drop policy if exists "Deny all client access" on studio_content_cache;
create policy "Deny all client access" on studio_content_cache for all using (false);

-- Atomic hit-counter bump on every cache hit, mirroring the retired
-- courses_cache table's own increment_cache_hit_count above.
create or replace function increment_studio_cache_hit_count(p_cache_id uuid)
returns void
language sql
as $$
  update studio_content_cache set hit_count = hit_count + 1, last_hit_at = now() where id = p_cache_id;
$$;

-- ---------------------------------------------------------------------------
-- course_highlights: text selections a student highlights while reading a
-- public showcase course (app/api/highlights/route.ts). Like studio_courses
-- and user_notes above, this was never defined in this file — created by
-- hand in the Supabase SQL editor. Reverse-engineered from the route's own
-- select/insert calls (id, user_id, course_slug, selected_text, color,
-- created_at); `id`'s real type (bigint identity vs uuid) was never pinned
-- down in code (the route never reads it back by id, only inserts and
-- selects), so it's asserted here by the same bigint-identity convention as
-- user_notes — verify against the real production column before treating
-- this as authoritative.
-- ---------------------------------------------------------------------------
create table if not exists course_highlights (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  course_slug text not null,
  selected_text text not null,
  color text not null default 'yellow',
  created_at timestamptz not null default now()
);

create index if not exists course_highlights_user_id_course_slug_idx on course_highlights (user_id, course_slug);

alter table course_highlights enable row level security;

drop policy if exists "Users manage their own highlights" on course_highlights;
create policy "Users manage their own highlights" on course_highlights
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Same defense-in-depth gap as the quota reserve_*/refund_*/increment_*
-- functions above (see that block's comment, line ~349): every one of these
-- read/hit-counter functions is `SECURITY INVOKER` (the default), and
-- Postgres grants EXECUTE to PUBLIC on new functions unless revoked — so
-- without this, any `anon`/`authenticated` caller can invoke them directly
-- via PostgREST's `/rpc/...` endpoint. A closing security audit (RLS
-- table-by-table review) confirmed none of these are currently exploitable
-- — each one only ever reads a table that's already deny-all or
-- owner-scoped, so a direct anon/authenticated call just gets 0 rows back,
-- RLS-filtered upstream regardless of the arguments passed in. Revoked here
-- anyway, for the same reason the quota functions above were: so this stays
-- true by construction instead of resting on "every table this function
-- reads happens to have the right RLS today."
revoke execute on function increment_cache_hit_count(text) from anon, authenticated;
revoke execute on function increment_studio_cache_hit_count(uuid) from anon, authenticated;
revoke execute on function increment_variation_hit_count(uuid) from anon, authenticated;
revoke execute on function increment_course_workspace_cache_hit_count(text, text) from anon, authenticated;
revoke execute on function increment_flashcards_content_cache_hit_count(text) from anon, authenticated;
revoke execute on function weakness_radar(uuid) from anon, authenticated;
revoke execute on function course_mastery(uuid) from anon, authenticated;
revoke execute on function course_weak_qcms(uuid, text, int) from anon, authenticated;
revoke execute on function match_semantic_cache(vector(1536), text, float, int) from anon, authenticated;
revoke execute on function match_similar_courses_by_slug(text, float, int) from anon, authenticated;
revoke execute on function match_similar_source_chunks(text, float) from anon, authenticated;
revoke execute on function match_chunks_against_course(text, text, float) from anon, authenticated;
revoke execute on function match_course_chunks(vector(1536), int) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Study Planner ("To-Do List & AI Study Planner") — OMEGA-SHIELD.
-- One `study_plans` row per exam-prep plan a student configures (which
-- modules, hours/day, rest days, exam date, optional uploaded programme
-- file), holding the AI-generated weekly schedule as jsonb plus the
-- refinement chat transcript so re-opening a draft never loses either.
-- `study_plan_tasks` is the flat, checkable to-do list actually exploded
-- from `generated_plan` once the student hits "Start" — one row per
-- course/day item, independent of the jsonb blob so ticking a checkbox is a
-- single cheap row UPDATE, not a read-modify-write of the whole plan.
create table if not exists study_plans (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  module_ids bigint[] not null default '{}',
  hours_per_day numeric not null,
  -- Count of rest days per week (0-6), not specific weekdays — matches the
  -- "Input Number/Select" config UI, which only ever asks "how many".
  rest_days integer not null default 0,
  exam_date date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed')),
  -- The AI's structured weekly schedule (array of {date, items: [{title,
  -- moduleId, hours, note}]}) — redrawn as the Timeline view and as the
  -- editable working copy the refinement chat updates before the student
  -- saves. Null until the first successful generation.
  generated_plan jsonb,
  -- [{role: "user"|"assistant", content: string}, ...] — the refinement
  -- chat transcript, persisted so leaving and reopening a draft plan never
  -- loses the conversation that shaped it.
  refinement_chat jsonb not null default '[]',
  -- Public Supabase Storage URL of the optionally uploaded "programme
  -- officiel" file (PDF/image) — same convention as studio_courses'/
  -- upload's source_file_url, null when the student typed a manual list.
  source_file_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_plans_user_id_idx on study_plans (user_id);

alter table study_plans enable row level security;
drop policy if exists "Users manage their own study plans" on study_plans;
create policy "Users manage their own study plans" on study_plans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists study_plan_tasks (
  id bigint generated by default as identity primary key,
  plan_id bigint not null references study_plans (id) on delete cascade,
  -- Denormalized from study_plans.user_id — same convention as
  -- course_chat_history/qcm_attempts (both plan_id-scoped AND user_id-
  -- scoped): lets RLS and every query filter directly on user_id without a
  -- join back through study_plans just to prove ownership.
  user_id uuid not null references auth.users (id) on delete cascade,
  module_id bigint references curriculum_modules (id) on delete set null,
  title text not null,
  date_scheduled date not null,
  hours numeric,
  is_completed boolean not null default false,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists study_plan_tasks_plan_id_idx on study_plan_tasks (plan_id);
create index if not exists study_plan_tasks_user_id_date_idx on study_plan_tasks (user_id, date_scheduled);

alter table study_plan_tasks enable row level security;
drop policy if exists "Users manage their own study plan tasks" on study_plan_tasks;
create policy "Users manage their own study plan tasks" on study_plan_tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- NEXUS — Group Chat (Realtime).
--
-- Architectural note that does NOT apply anywhere else in this schema: every
-- other table in this file is read/written exclusively through the
-- service-role client (getSupabaseAdmin()) from server API routes, which
-- bypasses RLS entirely — RLS on those tables is defense-in-depth, not the
-- real gate (see the security audit note near the top of this file). Group
-- Chat is the ONE exception. Supabase Realtime's `postgres_changes`
-- subscription is a live websocket connection authenticated as the
-- CONNECTING USER (via lib/supabase/client.ts, the anon-key browser client),
-- and it evaluates SELECT policies live, per row, against that user's own
-- JWT — there is no service-role in that path. This means the SELECT policy
-- on chat_messages below is THE actual security boundary for who receives a
-- live message in real time, not just a backstop. Get it wrong and either
-- messages leak across groups in real time, or the live feed silently shows
-- nothing. (Message history GET, and every write, still go through server
-- API routes for rate-limiting/sanitization — only the live subscription
-- talks to Supabase directly as the user.)
create table if not exists chat_groups (
  -- uuid, not bigint identity — matches this schema's own DOMINANT
  -- convention (10 other tables already use `uuid default gen_random_uuid()`;
  -- bigint identity is the minority pattern, used only by the older
  -- curriculum/legacy pipeline). Also fixes a real reported bug: the app
  -- code originally assumed a numeric id (`Number(params.id)` in the group
  -- chat room route), which broke the moment the id was actually a UUID.
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- References auth.users directly (not `profiles`) — matches every other
  -- per-user FK already in this file (profiles.id IS auth.users.id 1:1, so
  -- this is the same identity either way, just consistent with convention).
  admin_id uuid not null references auth.users (id) on delete cascade,
  join_code text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists chat_groups_admin_id_idx on chat_groups (admin_id);

alter table chat_groups enable row level security;

drop policy if exists "Members and admins can see their own groups" on chat_groups;
create policy "Members and admins can see their own groups" on chat_groups
  for select
  using (
    auth.uid() = admin_id
    or exists (
      select 1 from chat_members
      where chat_members.group_id = chat_groups.id
        and chat_members.user_id = auth.uid()
        and chat_members.status = 'accepted'
    )
  );

create table if not exists chat_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references chat_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  -- Snapshotted from auth.updateUser's user_metadata.full_name at the moment
  -- THIS user creates/joins the group (the acting user's own metadata is
  -- already in hand server-side then, zero extra lookup) — `full_name`/
  -- `university` live only in auth.users.user_metadata, never in `profiles`
  -- (see app/api/profile/route.ts's own header comment), and there is no
  -- bulk "get these N users' metadata" call in supabase-js, only one-by-one
  -- admin.getUserById — denormalizing here avoids an N+1 fetch every time
  -- the member list or pending-requests tab renders.
  display_name text,
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists chat_members_group_id_idx on chat_members (group_id);
create index if not exists chat_members_user_id_idx on chat_members (user_id);

alter table chat_members enable row level security;

drop policy if exists "See own membership or memberships of groups you admin" on chat_members;
create policy "See own membership or memberships of groups you admin" on chat_members
  for select
  using (
    auth.uid() = user_id
    or auth.uid() = (select admin_id from chat_groups where chat_groups.id = chat_members.group_id)
  );

-- The literal rule this feature's brief asked for. Every accept/reject in
-- this app happens through a server route (service-role, which bypasses
-- this), so in practice this is defense-in-depth like the rest of the
-- schema — written to hold on its own regardless.
drop policy if exists "Only the group admin can update membership status" on chat_members;
create policy "Only the group admin can update membership status" on chat_members
  for update
  using (auth.uid() = (select admin_id from chat_groups where chat_groups.id = chat_members.group_id))
  with check (auth.uid() = (select admin_id from chat_groups where chat_groups.id = chat_members.group_id));

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references chat_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null default 'text' check (type in ('text', 'image', 'video', 'audio')),
  content_text text,
  media_url text,
  -- Same denormalization reasoning as chat_members.display_name — snapshotted
  -- at send time from the sender's own auth.users.user_metadata.full_name,
  -- so the message list (and the Realtime feed) never needs a per-sender
  -- lookup to show who wrote what.
  sender_name text,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_group_id_created_at_idx on chat_messages (group_id, created_at);

alter table chat_messages enable row level security;

-- LOAD-BEARING (see the architectural note above) — this is what Realtime
-- actually checks per message, per subscribed client.
drop policy if exists "Accepted members can read group messages" on chat_messages;
create policy "Accepted members can read group messages" on chat_messages
  for select
  using (
    exists (
      select 1 from chat_members
      where chat_members.group_id = chat_messages.group_id
        and chat_members.user_id = auth.uid()
        and chat_members.status = 'accepted'
    )
  );

-- Defense-in-depth (real message sends go through POST /api/groups/[id]/
-- messages and /media, service-role + an explicit membership check) — same
-- reasoning as chat_members' UPDATE policy above.
drop policy if exists "Accepted members can send group messages" on chat_messages;
create policy "Accepted members can send group messages" on chat_messages
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from chat_members
      where chat_members.group_id = chat_messages.group_id
        and chat_members.user_id = auth.uid()
        and chat_members.status = 'accepted'
    )
  );

-- Idempotent Realtime enablement — `alter publication ... add table` errors
-- on a re-run if the table is already a member, which a single-file,
-- run-it-again schema script (this one) cannot assume away.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table chat_messages;
  end if;
end $$;
