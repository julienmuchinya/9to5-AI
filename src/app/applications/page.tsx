"use client";

import Link from "next/link";
import { useLocalStore } from "@/hooks/use-store";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export default function ApplicationsPage() {
  const { store, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  const apps = store.applications.map((a) => {
    const job = store.jobs.find((j) => j.id === a.job_id);
    return { ...a, job };
  });

  return (
    <div>
      <PageHeader title="Applications" description="Track every application and decision" />
      {apps.length === 0 ? (
        <EmptyState message="No applications yet" />
      ) : (
        <ul className="space-y-3">
          {apps.map((a) => (
            <li key={a.id}>
              <Link href={`/applications/${a.id}`}>
                <Card className="transition hover:border-[var(--accent)]">
                  <div className="flex justify-between">
                    <div>
                      <p className="font-medium">{a.job?.title ?? "Unknown job"}</p>
                      <p className="text-sm text-[var(--muted)]">{a.job?.company_name}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge>{a.status}</Badge>
                      {a.decision && <Badge variant={a.decision === "AUTO_APPLY" ? "success" : "warning"}>{a.decision}</Badge>}
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
