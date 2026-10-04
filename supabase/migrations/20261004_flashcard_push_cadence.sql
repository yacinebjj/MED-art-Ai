-- Flashcard reminder cadence — exactly one push per interval per student,
-- whatever triggers it (hourly cron, or the open-tab fallback on any of the
-- student's devices). lib/push/dispatch.ts claims the next slot with a
-- compare-and-set on flashcard_push_last_sent_at, so concurrent triggers can
-- never both send.
--
-- flashcard_push_interval_minutes: the student's choice in Paramètres
-- (1 h by default, 2 h or 4 h).
--
-- Idempotent: safe to run more than once.

alter table public.profiles
  add column if not exists flashcard_push_interval_minutes integer not null default 60;

alter table public.profiles
  add column if not exists flashcard_push_last_sent_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_flashcard_push_interval_check'
  ) then
    alter table public.profiles
      add constraint profiles_flashcard_push_interval_check
      check (flashcard_push_interval_minutes in (60, 120, 240));
  end if;
end $$;

notify pgrst, 'reload schema';
