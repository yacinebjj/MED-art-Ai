-- Content-addressed exam question pool (lib/exam-harvested-qcms.ts).
--
-- exam_harvested_qcms rows were reachable only through course_id — a
-- per-student upload id — so every student holding the same polycopié grew a
-- private pool from zero, and the shortfall questions another student's exam
-- had already paid for were generated (and billed) again. content_hash is
-- sha256(normalizeText(explication ?? raw_text)) of the source course, the
-- same basis as exam_content_cache: lookups match course_id OR content_hash,
-- so one pool grows per course CONTENT, shared platform-wide.
--
-- Until this runs, the app detects the missing column and keeps the old
-- course_id-only behavior. Idempotent: safe to re-run.

alter table public.exam_harvested_qcms add column if not exists content_hash text;

create index if not exists exam_harvested_qcms_content_hash_idx
  on public.exam_harvested_qcms (content_hash)
  where content_hash is not null;

notify pgrst, 'reload schema';
