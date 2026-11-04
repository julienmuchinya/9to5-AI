import { requireUser } from "@/lib/v2/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { markApplied } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default" }> = {
  submitted: { label: "Submitted", variant: "success" },
  queued: { label: "Queued for next run", variant: "default" },
  needs_user: { label: "Needs you", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
  closed: { label: "Posting closed", variant: "default" },
};

export default async function ApplicationsPage() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("applications")
    .select("id,status,error,apply_url,submitted_at,created_at,requested_by,jobs(title,company_name,url)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  type Row = { id: string; status: string; error: string | null; apply_url: string | null; submitted_at: string | null; created_at: string; requested_by: string; jobs: { title: string; company_name: string; url: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  const needs = rows.filter((r) => r.status === "needs_user");
  const rest = rows.filter((r) => r.status !== "needs_user");

  const item = (r: Row) => {
    const s = STATUS[r.status] ?? { label: r.status, variant: "default" as const };
    return (
      <Card key={r.id} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{r.jobs?.title ?? "Job"}</p>
            <p className="text-sm text-[var(--muted)]">
              {r.jobs?.company_name} · {r.submitted_at ? `submitted ${new Date(r.submitted_at).toLocaleString()}` : `added ${new Date(r.created_at).toLocaleDateString()}`} · by {r.requested_by}
            </p>
            <div className="mt-2">
              <Badge variant={s.variant}>{s.label}</Badge>
            </div>
            {r.error && <p className="mt-2 text-xs text-[var(--muted)]">{r.error}</p>}
          </div>
          {r.status === "needs_user" && (
            <div className="flex shrink-0 gap-2">
              <a href={r.apply_url ?? r.jobs?.url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
                Open application
              </a>
              <form action={markApplied.bind(null, r.id)}>
                <button className="rounded-lg bg-[var(--border)] px-3 py-1.5 text-sm">I applied</button>
              </form>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Applications" description="Everything the agent submitted, queued, or handed back to you." />
      {rows.length === 0 && <EmptyState message="No applications yet. Click Apply on a matched job, ask in Chat, or turn on auto-submit." />}
      {needs.length > 0 && (
        <>
          <h2 className="mb-3 font-semibold">Needs you ({needs.length})</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">CAPTCHAs, unusual questions, or sites the agent can’t submit to. Open, submit, then click “I applied”.</p>
          <div className="mb-8 space-y-3">{needs.map(item)}</div>
        </>
      )}
      {rest.length > 0 && <div className="space-y-3">{rest.map(item)}</div>}
    </div>
  );
}
