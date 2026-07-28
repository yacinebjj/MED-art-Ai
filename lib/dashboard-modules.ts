/** Shared shapes for the dashboard's "Mes cours" / "Mes modules" split — see app/dashboard/(shell)/page.tsx. */

export interface PublicCourseSummary {
  id: number;
  slug: string;
  title: string;
  module_id: number | null;
}

export interface ModuleSummary {
  id: number;
  name: string;
}
