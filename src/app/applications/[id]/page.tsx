"use client";

import { use, type ReactNode } from "react";
import Link from "next/link";
import { useLocalStore } from "@/hooks/use-store";
import { Badge, Card, PageHeader } from "@/components/ui";

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { store, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  const app = store.applications.find((a) => a.id === id);
  const job = app ? store.jobs.find((j) => j.id === app.job_id) : null;
  const reason = app?.decision_reason ?? {};

  if (!app) {
    return (
      <div>
        <p>Application not found.</p>
        <Link href="/applications" className="text-[var(--accent)]">Back</Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={job?.title ?? String(reason.jobTitle ?? "Application")}
        description={job?.company_name ?? String(reason.company ?? "")}
        action={<Badge>{app.decision ?? app.status}</Badge>}
      />

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">Job details</h2>
        <dl className="space-y-2 text-sm">
          <AuditRow label="Company" value={job?.company_name ?? String(reason.company ?? "—")} />
          <AuditRow label="Job title" value={job?.title ?? String(reason.jobTitle ?? "—")} />
          <AuditRow
            label="Job URL"
            value={
              job?.url ?? String(reason.jobUrl ?? "")
                ? (
                    <a
                      href={job?.url ?? String(reason.jobUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] break-all"
                    >
                      {job?.url ?? String(reason.jobUrl)}
                    </a>
                  )
                : "—"
            }
          />
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Scores</h2>
          <dl className="space-y-2 text-sm">
            <AuditRow label="Fit score" value={fmtPct(app.fit_score)} />
            <AuditRow label="Trust score" value={fmtPct(app.trust_score)} />
            <AuditRow label="Resume match" value={fmtPct(app.resume_match_score)} />
            <AuditRow label="Cover letter match" value={fmtPct(app.cover_letter_match_score)} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Materials selected</h2>
          <dl className="space-y-2 text-sm">
            <AuditRow label="Resume template" value={String(reason.resumeTemplate ?? "—")} />
            <AuditRow label="Cover letter template" value={String(reason.coverLetterTemplate ?? "—")} />
            <AuditRow
              label="Cover letter reused"
              value={reason.coverReuse === true ? "Yes" : reason.coverReuse === false ? "No" : "—"}
            />
            <AuditRow
              label="Truth filter"
              value={
                reason.truthFilterPassed === true
                  ? "Passed"
                  : reason.truthFilterPassed === false
                    ? "Failed"
                    : "—"
              }
            />
          </dl>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Decision reason</h2>
          <dl className="space-y-2 text-sm">
            <AuditRow label="Decision code" value={String(reason.code ?? app.decision ?? "—")} />
            <AuditRow label="Explanation" value={String(reason.reason ?? "—")} />
          </dl>
        </Card>
      </div>

      <Link href="/applications" className="mt-6 inline-block text-sm text-[var(--accent)]">
        ← Back to applications
      </Link>
    </div>
  );
}

function fmtPct(n?: number) {
  return n != null ? `${n}%` : "—";
}

function AuditRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="sm:text-right">{value}</dd>
    </div>
  );
}
