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
