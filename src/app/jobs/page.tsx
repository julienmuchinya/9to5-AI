"use client";

import { useLocalStore } from "@/hooks/use-store";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export default function JobsPage() {
  const { store, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  const dupes = store.jobs.filter((j) => j.duplicate_status === "duplicate").length;

  return (
    <div>
      <PageHeader
        title="Jobs"
        description={`Discovered and analyzed postings · ${store.jobs.length} total${dupes ? ` · ${dupes} duplicates touched` : ""}`}
      />
      {store.jobs.length === 0 ? (
        <EmptyState message="No jobs yet. Run the 9to5 AI agent to scan mock job alerts and company pages." />
      ) : (
        <ul className="space-y-3">
          {store.jobs.map((j) => (
            <li key={j.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{j.title}</p>
                    <p className="text-sm text-[var(--muted)]">{j.company_name}</p>
                    {j.location && (
                      <p className="text-xs text-[var(--muted)]">
                        {j.location}
                        {j.remote_type ? ` · ${j.remote_type}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {j.decision && <Badge variant="success">{j.decision}</Badge>}
                    <Badge>{j.status}</Badge>
                    {j.source && <Badge>{j.source}</Badge>}
                    {j.fit_score != null && (
                      <Badge variant="success">Fit {j.fit_score}%</Badge>
                    )}
                    {j.trust_score != null && <Badge>Trust {j.trust_score}%</Badge>}
                    {j.scam_passed === false && <Badge variant="warning">Scam risk</Badge>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                  {j.date_found && (
                    <span>Found {new Date(j.date_found).toLocaleDateString()}</span>
                  )}
                  {j.resume_template && <span>Resume: {j.resume_template}</span>}
                  {j.cover_letter_template && (
                    <span>Cover: {j.cover_letter_template}</span>
                  )}
                  {j.duplicate_status && <span>{j.duplicate_status}</span>}
                </div>
                {j.decision_reason && (
                  <p className="mt-2 text-xs text-[var(--muted)]">{j.decision_reason}</p>
                )}
                {j.url && (
                  <a
                    href={j.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block text-sm text-[var(--accent)]"
                  >
                    View posting
                  </a>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
