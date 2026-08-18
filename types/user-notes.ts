/**
 * One row of the (manually-created, see supabase/schema.sql) `user_notes`
 * table — "Mes notes", entirely independent of any course/module.
 *
 * `id` is typed as `string` and treated as an OPAQUE identifier throughout —
 * this table was created by hand in the Supabase SQL editor, so its primary
 * key's real column type (bigint vs uuid) was never pinned down in code.
 * Never `Number()`-coerce it: that silently turns a uuid id into `NaN` and
 * every mutation on that note starts failing with "Identifiant de note
 * invalide" (see app/api/notes/[id]/route.ts's parseNoteId).
 */
export interface UserNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}
