-- EXAM GENOME — the bank of real past exam papers, scoped to ONE faculty and
-- ONE track: Faculté de Médecine, Université Saad Dahlab Blida 1, Médecine
-- (general medicine), years 1 to 6. Pharmacy, dentistry, other faculties and
-- other years are refused here by CHECK constraints and triggers — the third
-- lock after the app's schemas (lib/exam-genome/scope.ts) and the paper's own
-- header (lib/exam-genome/normalize.ts, detectPaperScope).
--
--   eg_exam_units      the 46 official exam units of years 1-6 (arrêtés 617/2018,
--                      1058/2019, 786/2020, 914/2021, 731/2022, 844/2023), seeded
--                      below and mirrored in lib/exam-genome/blida-catalog.ts
--   eg_papers          one exam paper: unit, academic year, session (normale /
--                      rattrapage), sitting (EMD1, EMD2, single paper, synthèse),
--                      provenance, review status
--   eg_sources         the files a paper was read from (sha256: an exact
--                      re-upload is refused before any parsing)
--   eg_questions       its questions (QCS / QCM / type K / QROC), their
--                      fingerprint (norm_text, content_hash) and family (the same
--                      question asked in other years), their effective key
--   eg_answer_keys     every key claim (official grid, teacher, reviewer,
--                      students, AI) with its trust level 0-4
--   eg_practice_attempts, eg_item_stats
--                      answers given in Blida-style practice papers, and the item
--                      analysis that flags a probably wrong key
--   eg_contributions   what students and ambassadors sent, and what became of it
--   eg_paper_coverage  view: per paper, how many questions and how many keyed
--
-- Service-role only (RLS on, no policies), like every table of this project:
-- the API routes of app/api/exam-genome do every read and write.
--
-- Until this file is run, the Exam Genome routes answer 503 and nothing else in
-- the app changes. Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Exam units
-- ---------------------------------------------------------------------------
create table if not exists public.eg_exam_units (
  code text primary key check (code ~ '^Y[1-6]-[A-Z0-9-]+$'),
  year_level smallint not null check (year_level between 1 and 6),
  kind text not null check (kind in ('module_annuel', 'module_semestriel', 'uei', 'uet', 'module', 'unite_clinique')),
  title text not null check (char_length(title) between 2 and 300),
  semester smallint check (semester in (1, 2)),
  normal_sittings text[] not null check (normal_sittings <@ array['emd1', 'emd2', 'unique', 'synthese'] and cardinality(normal_sittings) between 1 and 3),
  rotations boolean not null default false,
  -- The code carries the year: "Y3-UEI1" is a 3rd-year unit.
  check (substr(code, 2, 1)::smallint = year_level)
);

alter table public.eg_exam_units enable row level security;

insert into public.eg_exam_units (code, year_level, kind, title, semester, normal_sittings, rotations) values
  ('Y1-ANATOMIE', 1, 'module_annuel', 'Anatomie', null, array['emd1', 'emd2'], false),
  ('Y1-BIOCHIMIE', 1, 'module_annuel', 'Biochimie', null, array['emd1', 'emd2'], false),
  ('Y1-BIOSTAT', 1, 'module_annuel', 'Biostatistique - Informatique', null, array['emd1', 'emd2'], false),
  ('Y1-CHIMIE', 1, 'module_annuel', 'Chimie', null, array['emd1', 'emd2'], false),
  ('Y1-CYTOLOGIE', 1, 'module_annuel', 'Cytologie', null, array['emd1', 'emd2'], false),
  ('Y1-BIOPHYSIQUE', 1, 'module_annuel', 'Physique - Biophysique', null, array['emd1', 'emd2'], false),
  ('Y1-EMBRYOLOGIE', 1, 'module_semestriel', 'Embryologie', 1, array['unique'], false),
  ('Y1-SSH', 1, 'module_semestriel', 'Santé, Société et Humanité', 1, array['unique'], false),
  ('Y1-HISTOLOGIE', 1, 'module_semestriel', 'Histologie générale', 2, array['unique'], false),
  ('Y1-PHYSIOLOGIE', 1, 'module_semestriel', 'Physiologie générale', 2, array['unique'], false),
  ('Y2-UEI-CARDIO-RESP', 2, 'uei', 'UEI Appareil cardio-vasculaire, respiratoire et organes hématopoïétiques', null, array['unique'], false),
  ('Y2-UEI-DIGESTIF', 2, 'uei', 'UEI Appareil digestif', null, array['unique'], false),
  ('Y2-UEI-URINAIRE', 2, 'uei', 'UEI Appareil urinaire', null, array['unique'], false),
  ('Y2-UEI-ENDOCRINO', 2, 'uei', 'UEI Appareil endocrinien et de la reproduction', null, array['unique'], false),
  ('Y2-UEI-NERVEUX', 2, 'uei', 'UEI Appareil nerveux et organes des sens', null, array['unique'], false),
  ('Y2-GENETIQUE', 2, 'module', 'Génétique', null, array['unique'], false),
  ('Y2-IMMUNOLOGIE', 2, 'module', 'Immunologie fondamentale', null, array['unique'], false),
  ('Y3-UEI1', 3, 'uei', 'UEI 1 — Psychologie médicale, sémiologie générale, appareils cardio-vasculaire et respiratoire', 1, array['unique'], false),
  ('Y3-UEI2', 3, 'uei', 'UEI 2 — Appareils neurologique, locomoteur et cutané', 1, array['unique'], false),
  ('Y3-UEI3', 3, 'uei', 'UEI 3 — Appareils endocrinien, de la reproduction et urinaire', 2, array['unique'], false),
  ('Y3-UEI4', 3, 'uei', 'UEI 4 — Appareil digestif et organes hématopoïétiques', 2, array['unique'], false),
  ('Y3-UET-ACP', 3, 'uet', 'UET 1 — Anatomie et cytologie pathologiques', 1, array['unique'], false),
  ('Y3-UET-IMMUNOLOGIE', 3, 'uet', 'UET 2 — Immunologie', 1, array['unique'], false),
  ('Y3-UET-MICROBIOLOGIE', 3, 'uet', 'UET 3 — Microbiologie médicale', 2, array['unique'], false),
  ('Y3-UET-PARASITOLOGIE', 3, 'uet', 'UET 4 — Parasitologie - Mycologie', 2, array['unique'], false),
  ('Y3-UET-PHARMACOLOGIE', 3, 'uet', 'UET 5 — Pharmacologie clinique', 2, array['unique'], false),
  ('Y4-CARDIO-PNEUMO', 4, 'unite_clinique', 'Unité cardio-vasculaire et respiratoire', null, array['unique'], true),
  ('Y4-HGE', 4, 'unite_clinique', 'Hépato-gastro-entérologie', null, array['unique'], true),
  ('Y4-INFECTIOLOGIE', 4, 'unite_clinique', 'Maladies infectieuses', null, array['unique'], true),
  ('Y4-NEUROLOGIE', 4, 'unite_clinique', 'Neurologie', null, array['unique'], true),
  ('Y4-ONCO-HEMATO', 4, 'unite_clinique', 'Onco-hématologie', null, array['unique'], true),
  ('Y5-LOCOMOTEUR', 5, 'unite_clinique', 'Appareil locomoteur', null, array['unique'], true),
  ('Y5-GYNECO-OBST', 5, 'unite_clinique', 'Gynécologie-obstétrique', null, array['unique'], true),
  ('Y5-ENDOCRINO', 5, 'unite_clinique', 'Endocrinologie - maladies métaboliques', null, array['unique'], true),
  ('Y5-PEDIATRIE', 5, 'unite_clinique', 'Pédiatrie', null, array['unique'], true),
  ('Y5-SANTE-MENTALE', 5, 'unite_clinique', 'Santé mentale', null, array['unique'], true),
  ('Y5-URO-NEPHRO', 5, 'unite_clinique', 'Urologie - néphrologie', null, array['unique'], true),
  ('Y6-URGENCES', 6, 'unite_clinique', 'Médecine d''urgence', null, array['unique'], true),
  ('Y6-MEDECINE-LEGALE', 6, 'unite_clinique', 'Médecine légale et droit médical', null, array['unique'], true),
  ('Y6-PERSONNE-AGEE', 6, 'unite_clinique', 'Personne âgée', null, array['unique'], true),
  ('Y6-MALADIES-SYSTEMIQUES', 6, 'unite_clinique', 'Maladies systémiques', null, array['unique'], true),
  ('Y6-DERMATOLOGIE', 6, 'unite_clinique', 'Dermatologie', null, array['unique'], true),
  ('Y6-ORL', 6, 'unite_clinique', 'Oto-rhino-laryngologie (ORL)', null, array['unique'], true),
  ('Y6-OPHTALMOLOGIE', 6, 'unite_clinique', 'Ophtalmologie', null, array['unique'], true),
  ('Y6-SANTE-TRAVAIL', 6, 'unite_clinique', 'Santé au travail et environnement', null, array['unique'], true),
  ('Y6-EPIDEMIOLOGIE', 6, 'unite_clinique', 'Épidémiologie - méthodologie de recherche - lecture critique d''article - santé publique et économie de la santé', null, array['unique'], true)
on conflict (code) do update set
  year_level = excluded.year_level,
  kind = excluded.kind,
  title = excluded.title,
  semester = excluded.semester,
  normal_sittings = excluded.normal_sittings,
  rotations = excluded.rotations;

-- ---------------------------------------------------------------------------
-- Papers
-- ---------------------------------------------------------------------------
create table if not exists public.eg_papers (
  id uuid primary key default gen_random_uuid(),
  -- The scope lock: one faculty, one track, years 1-6.
  faculty text not null default 'blida1_medecine' check (faculty = 'blida1_medecine'),
  track text not null default 'medecine' check (track = 'medecine'),
  year_level smallint not null check (year_level between 1 and 6),
  unit_code text not null references public.eg_exam_units (code),
  academic_year text not null check (
    academic_year ~ '^20[0-9]{2}/20[0-9]{2}$'
    and substr(academic_year, 6, 4)::int = substr(academic_year, 1, 4)::int + 1
    and substr(academic_year, 1, 4)::int between 2010 and 2035
  ),
  session text not null check (session in ('normale', 'rattrapage')),
  sitting text not null check (sitting in ('emd1', 'emd2', 'unique', 'synthese')),
  rotation smallint check (rotation between 1 and 12),
  variant text check (char_length(variant) between 1 and 12),
  exam_date date,
  duration_minutes smallint check (duration_minutes between 10 and 480),
  provenance text not null check (provenance in ('official', 'teacher', 'student_copy', 'student_reconstruction', 'third_party')),
  status text not null default 'needs_review' check (status in ('needs_review', 'published', 'rejected', 'duplicate', 'taken_down')),
  duplicate_of uuid references public.eg_papers (id) on delete set null,
  -- What the paper's own header said: an out-of-scope paper is never stored.
  scope_verdict text not null check (scope_verdict in ('in_scope', 'unverified')),
  legacy_programme boolean not null default false,
  question_count integer not null default 0 check (question_count >= 0),
  parse_confidence real check (parse_confidence between 0 and 1),
  parse_warnings text[] not null default '{}',
  notes text check (char_length(notes) <= 2000),
  contributed_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The unit's year is the paper's year ("Y3-…" units only in 3rd-year papers).
  check (substr(unit_code, 2, 1)::smallint = year_level),
  check (session = 'normale' or sitting = 'unique'),
  check (status <> 'duplicate' or duplicate_of is not null),
  check (duplicate_of is distinct from id)
);

-- One published paper per exam slot (a rotation or a variant "sujet A/B" is its own slot).
create unique index if not exists eg_papers_published_slot_idx
  on public.eg_papers (unit_code, academic_year, session, sitting, coalesce(rotation, 0), coalesce(variant, ''))
  where status = 'published';
create index if not exists eg_papers_unit_idx on public.eg_papers (unit_code, academic_year);
create index if not exists eg_papers_status_idx on public.eg_papers (status, created_at desc);

alter table public.eg_papers enable row level security;

-- FUNCTION  eg_papers_guard() → trigger
--   Purpose     The rules a CHECK cannot see because they need the unit: the
--               normal-session sitting must be one the unit holds (Y1 annual
--               modules: EMD1/EMD2; the rest: a single paper; synthèse always
--               allowed), a rotation only on a clinical unit, the exam date
--               inside its academic year (September to the next October).
--               Also stamps updated_at.
--   Runs as     the caller; language plpgsql.
--   Called by   trigger eg_papers_guard_trg, before insert or update.
create or replace function public.eg_papers_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  u public.eg_exam_units%rowtype;
  first_year int := substr(new.academic_year, 1, 4)::int;
begin
  select * into u from public.eg_exam_units where code = new.unit_code;
  if new.session = 'normale' and new.sitting <> 'synthese' and not (new.sitting = any (u.normal_sittings)) then
    raise exception 'eg_papers: % holds % in its normal session, not %', new.unit_code, array_to_string(u.normal_sittings, '/'), new.sitting
      using errcode = 'check_violation';
  end if;
  if new.rotation is not null and not u.rotations then
    raise exception 'eg_papers: % is not taught in clinical rotations', new.unit_code using errcode = 'check_violation';
  end if;
  if new.exam_date is not null and (new.exam_date < make_date(first_year, 9, 1) or new.exam_date > make_date(first_year + 1, 10, 31)) then
    raise exception 'eg_papers: % is outside the academic year %', new.exam_date, new.academic_year using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists eg_papers_guard_trg on public.eg_papers;
create trigger eg_papers_guard_trg
  before insert or update on public.eg_papers
  for each row execute function public.eg_papers_guard();

-- ---------------------------------------------------------------------------
-- Source files
-- ---------------------------------------------------------------------------
create table if not exists public.eg_sources (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid references public.eg_papers (id) on delete cascade,
  storage_path text not null unique,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  byte_size integer not null check (byte_size > 0),
  page_count integer check (page_count > 0),
  extraction text not null check (extraction in ('text_layer', 'ocr')),
  extracted_chars integer not null default 0,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists eg_sources_paper_idx on public.eg_sources (paper_id);

alter table public.eg_sources enable row level security;

-- ---------------------------------------------------------------------------
-- Questions
-- ---------------------------------------------------------------------------
create table if not exists public.eg_questions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.eg_papers (id) on delete cascade,
  position smallint not null check (position between 1 and 400),
  format text not null check (format in ('qcs', 'qcm', 'combinaison', 'qroc', 'cas_clinique')),
  polarity text check (polarity in ('rj', 'rf')),
  -- The statement of the exercise / clinical case the question belongs to.
  context text check (char_length(context) <= 8000),
  stem text not null check (char_length(stem) <= 4000),
  propositions jsonb not null default '[]'::jsonb check (jsonb_typeof(propositions) = 'array' and jsonb_array_length(propositions) <= 8),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 5),
  -- Fingerprint (lib/exam-genome/fingerprint.ts): content words, and their 64-bit FNV-1a.
  norm_text text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{16}$'),
  -- The same question asked in other papers points to the first one stored (null: it is its own family).
  family_id uuid references public.eg_questions (id) on delete set null,
  parse_confidence real not null check (parse_confidence between 0 and 1),
  parse_issues text[] not null default '{}',
  -- The key students see, resolved by lib/exam-genome/trust.ts from eg_answer_keys.
  effective_answer text check (effective_answer ~ '^A?B?C?D?E?$' and char_length(effective_answer) between 1 and 5),
  effective_level smallint not null default 0 check (effective_level between 0 and 4),
  key_contested boolean not null default false,
  created_at timestamptz not null default now(),
  unique (paper_id, position),
  check (format not in ('qcs', 'qcm', 'combinaison') or jsonb_array_length(options) between 4 and 5),
  check (format <> 'combinaison' or jsonb_array_length(propositions) >= 4),
  check (char_length(stem) >= 8 or context is not null),
  check ((effective_answer is null) = (effective_level = 0)),
  check (family_id is distinct from id)
);

create index if not exists eg_questions_family_idx on public.eg_questions (family_id) where family_id is not null;
create index if not exists eg_questions_hash_idx on public.eg_questions (content_hash);

alter table public.eg_questions enable row level security;

-- ---------------------------------------------------------------------------
-- Answer-key claims
-- ---------------------------------------------------------------------------
create table if not exists public.eg_answer_keys (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.eg_questions (id) on delete cascade,
  answer text not null check (answer ~ '^A?B?C?D?E?$' and char_length(answer) between 1 and 5),
  level smallint not null check (level between 1 and 4),
  source text not null check (source in ('official_grid', 'teacher', 'expert_review', 'community_vote', 'student_document', 'ai')),
  contributor_id uuid references auth.users (id) on delete set null,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  -- The ceiling of each source (scope.ts, maxTrustForSource): a student's document or an AI only proposes.
  check (source not in ('student_document', 'ai') or level = 1),
  check (source <> 'community_vote' or level <= 2),
  check (source not in ('teacher', 'expert_review') or level <= 3)
);

-- One voice per person per question and source. Not a partial index: the review
-- route upserts on exactly these columns (ON CONFLICT cannot target a partial
-- index without its predicate), and rows without a contributor stay distinct
-- anyway (NULLs never collide in a unique index).
create unique index if not exists eg_answer_keys_one_voice_idx
  on public.eg_answer_keys (question_id, source, contributor_id);
create index if not exists eg_answer_keys_question_idx on public.eg_answer_keys (question_id);

alter table public.eg_answer_keys enable row level security;

-- FUNCTION  eg_answer_keys_guard() → trigger
--   Purpose     An "official grid" key reaches level 4 only on a paper whose
--               provenance is official; on any other paper it stays a
--               proposal (level 1). Rejects the row otherwise.
--   Runs as     the caller; language plpgsql.
--   Called by   trigger eg_answer_keys_guard_trg, before insert or update.
create or replace function public.eg_answer_keys_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  paper_provenance text;
begin
  if new.source = 'official_grid' then
    select p.provenance into paper_provenance
      from public.eg_questions q join public.eg_papers p on p.id = q.paper_id
     where q.id = new.question_id;
    if new.level = 4 and paper_provenance is distinct from 'official' then
      raise exception 'eg_answer_keys: an official grid is level 4 only on an official paper (this one: %)', paper_provenance
        using errcode = 'check_violation';
    end if;
    if new.level not in (1, 4) then
      raise exception 'eg_answer_keys: an official grid is level 4 (official paper) or 1' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists eg_answer_keys_guard_trg on public.eg_answer_keys;
create trigger eg_answer_keys_guard_trg
  before insert or update on public.eg_answer_keys
  for each row execute function public.eg_answer_keys_guard();

-- ---------------------------------------------------------------------------
-- Practice attempts and item statistics
-- ---------------------------------------------------------------------------
create table if not exists public.eg_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  unit_code text not null references public.eg_exam_units (code),
  question_ids uuid[] not null check (cardinality(question_ids) between 1 and 200),
  -- question id → letters given ("BD"); a skipped question is absent.
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  score real check (score between 0 and 1),
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists eg_practice_attempts_user_idx on public.eg_practice_attempts (user_id, created_at desc);

alter table public.eg_practice_attempts enable row level security;

create table if not exists public.eg_item_stats (
  question_id uuid primary key references public.eg_questions (id) on delete cascade,
  responses integer not null default 0,
  p_value real,
  discrimination real,
  strong_alternative text,
  suspected_key_error boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.eg_item_stats enable row level security;

-- ---------------------------------------------------------------------------
-- Contributions
-- ---------------------------------------------------------------------------
create table if not exists public.eg_contributions (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('student', 'ambassador', 'teacher', 'admin')),
  declared_unit_code text references public.eg_exam_units (code),
  declared_academic_year text,
  declared_session text check (declared_session in ('normale', 'rattrapage')),
  declared_sitting text check (declared_sitting in ('emd1', 'emd2', 'unique', 'synthese')),
  source_id uuid references public.eg_sources (id) on delete set null,
  paper_id uuid references public.eg_papers (id) on delete set null,
  outcome text not null default 'received' check (outcome in ('received', 'ingested', 'duplicate', 'out_of_scope', 'unreadable', 'not_an_exam', 'rejected')),
  detail text check (char_length(detail) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists eg_contributions_contributor_idx on public.eg_contributions (contributor_id, created_at desc);

alter table public.eg_contributions enable row level security;

-- ---------------------------------------------------------------------------
-- Coverage
-- ---------------------------------------------------------------------------
-- Per paper: its slot, its status, how many questions, how many with a key of
-- level ≥ 2 (community or better) and ≥ 3 (expert or official).
-- lib/exam-genome/coverage.ts turns these rows into the coverage matrix.
create or replace view public.eg_paper_coverage as
select
  p.id,
  p.unit_code,
  p.year_level,
  p.academic_year,
  p.session,
  p.sitting,
  p.rotation,
  p.status,
  count(q.id) as question_count,
  count(q.id) filter (where q.effective_level >= 2 and not q.key_contested) as keyed,
  count(q.id) filter (where q.effective_level >= 3 and not q.key_contested) as verified
from public.eg_papers p
left join public.eg_questions q on q.paper_id = p.id
group by p.id;

revoke all on public.eg_paper_coverage from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ingest, in one transaction
-- ---------------------------------------------------------------------------
-- FUNCTION  eg_ingest_paper(p jsonb) → uuid
--   Purpose     Stores a parsed paper in one transaction — the paper row, its
--               source file, its questions and the key claims the document
--               carried — so that a failure never leaves half a paper behind.
--               p = { paper: {…eg_papers columns}, source: {…eg_sources
--               columns}, questions: [{…eg_questions columns, keys: [{answer,
--               level, source}]}] }. Every CHECK and trigger above applies.
--   Returns     The new paper's id.
--   Runs as     its owner (SECURITY DEFINER); language plpgsql;
--               search_path = public.
--   Privileges  ALL revoked from public, anon, authenticated (service role only).
--   Called by   app/api/exam-genome/ingest/route.ts
create or replace function public.eg_ingest_paper(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  paper_id uuid;
  question jsonb;
  question_id uuid;
  claim jsonb;
begin
  insert into public.eg_papers (
    year_level, unit_code, academic_year, session, sitting, rotation, variant, exam_date, duration_minutes,
    provenance, status, duplicate_of, scope_verdict, legacy_programme, question_count, parse_confidence,
    parse_warnings, notes, contributed_by
  )
  select
    (x->>'year_level')::smallint, x->>'unit_code', x->>'academic_year', x->>'session', x->>'sitting',
    (x->>'rotation')::smallint, x->>'variant', (x->>'exam_date')::date, (x->>'duration_minutes')::smallint,
    x->>'provenance', coalesce(x->>'status', 'needs_review'), (x->>'duplicate_of')::uuid, x->>'scope_verdict',
    coalesce((x->>'legacy_programme')::boolean, false), jsonb_array_length(coalesce(p->'questions', '[]'::jsonb)),
    (x->>'parse_confidence')::real,
    coalesce(array(select jsonb_array_elements_text(coalesce(x->'parse_warnings', '[]'::jsonb))), '{}'),
    x->>'notes', (x->>'contributed_by')::uuid
  from (select p->'paper' as x) s
  returning id into paper_id;

  if p ? 'source' then
    insert into public.eg_sources (paper_id, storage_path, sha256, mime_type, byte_size, page_count, extraction, extracted_chars, uploaded_by)
    select paper_id, x->>'storage_path', x->>'sha256', x->>'mime_type', (x->>'byte_size')::int, (x->>'page_count')::int,
           x->>'extraction', coalesce((x->>'extracted_chars')::int, 0), (x->>'uploaded_by')::uuid
    from (select p->'source' as x) s;
  end if;

  for question in select * from jsonb_array_elements(coalesce(p->'questions', '[]'::jsonb)) loop
    insert into public.eg_questions (
      paper_id, position, format, polarity, context, stem, propositions, options, norm_text, content_hash,
      family_id, parse_confidence, parse_issues, effective_answer, effective_level, key_contested
    ) values (
      paper_id, (question->>'position')::smallint, question->>'format', question->>'polarity', question->>'context',
      question->>'stem', coalesce(question->'propositions', '[]'::jsonb), coalesce(question->'options', '[]'::jsonb),
      question->>'norm_text', question->>'content_hash', (question->>'family_id')::uuid,
      (question->>'parse_confidence')::real,
      coalesce(array(select jsonb_array_elements_text(coalesce(question->'parse_issues', '[]'::jsonb))), '{}'),
      question->>'effective_answer', coalesce((question->>'effective_level')::smallint, 0),
      coalesce((question->>'key_contested')::boolean, false)
    )
    returning id into question_id;

    for claim in select * from jsonb_array_elements(coalesce(question->'keys', '[]'::jsonb)) loop
      insert into public.eg_answer_keys (question_id, answer, level, source, contributor_id, note)
      values (question_id, claim->>'answer', (claim->>'level')::smallint, claim->>'source', (claim->>'contributor_id')::uuid, claim->>'note');
    end loop;
  end loop;

  return paper_id;
end;
$$;

revoke all on function public.eg_ingest_paper(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
