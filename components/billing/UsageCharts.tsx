"use client";

import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { Card } from "@/components/ui/Card";
import { RevealSection } from "@/components/ui/RevealSection";

/**
 * WAS hardcoded fake numbers (3.5h Monday, 40% QCM, etc.) shown identically
 * to every student regardless of whether they'd ever actually studied — no
 * real per-day study-time or per-feature usage tracking exists anywhere in
 * this app to compute genuine values from (Pomodoro only keeps a running
 * total in localStorage, never day-bucketed or synced server-side). Rather
 * than keep fabricating numbers, this now renders an honest empty state
 * until that real tracking pipeline exists as its own feature — a student
 * who hasn't studied yet sees "no data yet", never someone else's activity
 * dressed up as their own.
 */
const STUDY_TIME_DATA: { day: string; heures: number }[] = [];
const USAGE_BREAKDOWN_DATA: { name: string; value: number }[] = [];

const BRAND_INDIGO = "#6366f1";
const BRAND_TEAL = "#14b8a6";
const BRAND_VIOLET = "#a78bfa";
const PIE_COLORS = [BRAND_INDIGO, BRAND_TEAL, BRAND_VIOLET];

/**
 * Isolated in its own client-only component, loaded via next/dynamic with
 * `ssr: false` from the billing page — recharts reaches for `document`
 * while measuring SVG text during its own render, which crashes ("document
 * is not defined") under Next.js's default server-render pass for "use
 * client" components. Skipping SSR for just this chart pair (not the whole
 * billing page) fixes that without losing server rendering for everything
 * else on the page.
 */
function ChartEmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium text-foreground">Pas encore de données</p>
      <p className="max-w-[220px] text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function UsageCharts() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <RevealSection delay={0.1}>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground">Temps d'étude (7 derniers jours)</h3>
          <div className="mt-4 h-64">
            {STUDY_TIME_DATA.length === 0 ? (
              <ChartEmptyState label="Ton temps d'étude apparaîtra ici une fois que tu auras commencé à réviser." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={STUDY_TIME_DATA}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} unit="h" />
                  <Tooltip cursor={{ fill: "rgba(99,102,241,0.08)" }} formatter={(value) => [`${value}h`, "Temps d'étude"]} />
                  <Bar dataKey="heures" name="Heures" fill={BRAND_INDIGO} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </RevealSection>

      <RevealSection delay={0.2}>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground">Répartition de l'utilisation</h3>
          <div className="mt-4 h-64">
            {USAGE_BREAKDOWN_DATA.length === 0 ? (
              <ChartEmptyState label="La répartition de tes outils (QCM, Notes, Résumés...) apparaîtra ici après tes premières sessions." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={USAGE_BREAKDOWN_DATA} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={3}>
                    {USAGE_BREAKDOWN_DATA.map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [`${value}%`, name]} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </RevealSection>
    </div>
  );
}
