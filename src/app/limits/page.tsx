"use client";

import { useLocalStore } from "@/hooks/use-store";
import { DEFAULT_USAGE_LIMITS } from "@/lib/constants";
import { Card, PageHeader, StatCard } from "@/components/ui";

export default function LimitsPage() {
  const { store, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  const l = store.agent_usage_limits;

  const rows = [
    { label: "Emails scanned", cur: l.emails_scanned_today ?? 0, max: l.maxJobsAnalyzedPerDay },
    { label: "Companies scanned", cur: l.companies_scanned_today ?? 0, max: l.maxCompaniesScannedPerDay },
    { label: "Jobs saved", cur: l.jobs_saved_today ?? 0, max: l.maxJobsAnalyzedPerDay },
    { label: "Duplicates skipped", cur: l.duplicates_skipped_today ?? 0, max: l.maxJobsAnalyzedPerDay },
    { label: "Jobs analyzed", cur: l.jobs_analyzed_today, max: l.maxJobsAnalyzedPerDay },
    { label: "AI calls", cur: l.ai_calls_today, max: l.maxAiCallsPerDay },
    { label: "Cache hits", cur: l.cache_hits_today ?? 0, max: l.maxAiCallsPerDay },
    { label: "Applications", cur: l.applications_today, max: l.maxApplicationsPerDay },
    { label: "Outreach", cur: l.outreach_today, max: l.maxOutreachPerDay },
  ];

  return (
    <div>
      <PageHeader title="Usage" description="Part 3 intake limits — budget guard, $0 cost cap" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Estimated cost today"
          value={`$${(l.estimated_cost_today ?? 0).toFixed(2)}`}
          variant="success"
        />
        <StatCard label="Cost cap" value="$0.00" variant="success" />
      </div>
      <Card>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Warn at 80%, high-risk at 90%, stop at 100%. Part 3 never creates paid usage by default.
        </p>
        <ul className="space-y-4">
          {rows.map((r) => {
            const pct = r.max > 0 ? Math.round((r.cur / r.max) * 100) : 0;
            return (
              <li key={r.label}>
                <div className="flex justify-between text-sm">
                  <span>{r.label}</span>
                  <span>
                    {r.cur} / {r.max} ({pct}%)
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className={`h-full ${pct >= 100 ? "bg-red-500" : pct >= 90 ? "bg-amber-500" : "bg-[var(--accent)]"}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 text-xs text-[var(--muted)]">
          Defaults: {DEFAULT_USAGE_LIMITS.maxJobsAnalyzedPerDay} jobs analyzed/day,{" "}
          {DEFAULT_USAGE_LIMITS.maxCompaniesScannedPerDay} company scans/day
        </p>
      </Card>
    </div>
  );
}
