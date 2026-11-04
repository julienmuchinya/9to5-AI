import { requireUser } from "@/lib/v2/session";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { STAGE_LABEL, roleFamily } from "@/lib/v2/tracking";
import { markApplied, setApplicationStatus } from "../actions";

export const dynamic = "force-dynamic";

type Variant = "success" | "warning" | "danger" | "default";
const VARIANT: Record<string, Variant> = {
  submitted: "default",
  received: "default",
  under_review: "warning",
  interview: "success",
  offer: "success",
  rejected: "danger",
  needs_user: "warning",
  failed: "danger",
};
const TABS = [
  ["active", "In progress"],
  ["needs", "Needs you"],
  ["interview", "Interviews & offers"],
  ["rejected", "Rejected"],
  ["all", "All"],
] as const;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { supabase, user } = await requireUser();
  const { tab = "active" } = await searchParams;
  const [{ data }, { data: evs }] = await Promise.all([
    supabase
      .from("applications")
      .select("id,status,error,apply_url,answers,submitted_at,created_at,requested_by,resume_focus,status_updated_at,jobs(title,company_name,url)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("application_events").select("application_id,kind,source,detail,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1000),
  ]);
  type Row = {
    id: string;
    status: string;
    error: string | null;
    apply_url: string | null;
    answers: Record<string, string> | null;
    submitted_at: string | null;
    created_at: string;
    requested_by: string;
    resume_focus: string | null;
    jobs: { title: string; company_name: string; url: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const events = new Map<string, { kind: string; source: string; detail: string | null; created_at: string }[]>();
  for (const e of evs ?? []) events.set(e.application_id, [...(events.get(e.application_id) ?? []), e]);

  // ── What's working: response rates by role family and resume focus ──
  const sent = rows.filter((r) => r.submitted_at || ["submitted", "received", "under_review", "interview", "offer", "rejected"].includes(r.status));
  const progressed = (r: Row) => ["under_review", "interview", "offer"].includes(r.status);
  const stats = (key: (r: Row) => string | null) => {
    const m = new Map<string, { sent: number; good: number; rejected: number }>();
    for (const r of sent) {
      const k = key(r);
      if (!k) continue;
      const v = m.get(k) ?? { sent: 0, good: 0, rejected: 0 };
      v.sent++;
      if (progressed(r)) v.good++;
      if (r.status === "rejected") v.rejected++;
      m.set(k, v);
    }
    return [...m.entries()].sort((a, b) => b[1].good / b[1].sent - a[1].good / a[1].sent || b[1].sent - a[1].sent).slice(0, 6);
  };
  const byFamily = stats((r) => (r.jobs?.title ? roleFamily(r.jobs.title) : null));
  const byFocus = stats((r) => r.resume_focus);
  const count = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;

  const filtered = rows.filter((r) => {
    if (tab === "needs") return r.status === "needs_user";
    if (tab === "interview") return ["interview", "offer"].includes(r.status);
    if (tab === "rejected") return r.status === "rejected";
    if (tab === "active") return ["queued", "submitted", "received", "under_review"].includes(r.status);
    return true;
  });

  return (
    <div className="max-w-5xl">
      <PageHeader title="Applications" description="Every application, where it stands, and what’s working. Statuses update from your inbox when it’s connected." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Sent" value={sent.length} />
        <StatCard label="Under consideration" value={count(["received", "under_review"])} />
        <StatCard label="Interviews" value={count(["interview"])} />
        <StatCard label="Offers" value={count(["offer"])} />
        <StatCard label="Rejected" value={count(["rejected"])} />
      </div>

      {sent.length >= 3 && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {[
            ["Response rate by job type", byFamily],
            ["Response rate by resume focus", byFocus],
          ].map(([title, list]) => (
            <Card key={title as string} className="p-4">
              <h2 className="mb-3 text-sm font-semibold">{title as string}</h2>
              {(list as [string, { sent: number; good: number; rejected: number }][]).length === 0 && <p className="text-xs text-[var(--muted)]">Not enough data yet.</p>}
              <div className="space-y-2">
                {(list as [string, { sent: number; good: number; rejected: number }][]).map(([k, v]) => (
                  <div key={k} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{k}</span>
                      <span className="shrink-0 text-[var(--muted)]">
                        {v.good}/{v.sent} moved forward · {v.rejected} rejected
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-[var(--border)]">
                      <div className="h-1.5 rounded bg-emerald-500" style={{ width: `${Math.round((100 * v.good) / v.sent)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <a key={k} href={`?tab=${k}`} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-[var(--accent)] text-white" : "bg-[var(--border)]"}`}>
            {label}
            {k === "needs" && count(["needs_user"]) > 0 ? ` (${count(["needs_user"])})` : ""}
          </a>
        ))}
      </div>

      {rows.length === 0 && <EmptyState message="No applications yet. Click Apply on a matched job, ask in Chat, or turn on auto-submit." />}
      {rows.length > 0 && filtered.length === 0 && <EmptyState message="Nothing here right now." />}

      <div className="space-y-3">
        {filtered.map((r) => {
          const timeline = events.get(r.id) ?? [];
          const answers = Object.entries(r.answers ?? {}).filter(([, v]) => v);
          return (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.jobs?.title ?? "Job"}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {r.jobs?.company_name} ·{" "}
                    {r.submitted_at ? `applied ${new Date(r.submitted_at).toLocaleDateString()}` : `added ${new Date(r.created_at).toLocaleDateString()}`} · by {r.requested_by}
                    {r.resume_focus ? ` · resume led with ${r.resume_focus}` : ""}
                  </p>
                  <div className="mt-2">
                    <Badge variant={VARIANT[r.status] ?? "default"}>{STAGE_LABEL[r.status] ?? r.status}</Badge>
                  </div>
                  {r.error && r.status === "needs_user" && <p className="mt-2 text-xs text-amber-300">{r.error}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {(r.apply_url || r.jobs?.url) && (
                    <a
                      href={r.apply_url ?? r.jobs?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`rounded-lg px-3 py-1.5 text-sm ${r.status === "needs_user" ? "bg-[var(--accent)] text-white" : "bg-[var(--border)]"}`}
                    >
                      {r.status === "needs_user" ? "Open application" : "View posting"}
                    </a>
                  )}
                  {r.status === "needs_user" && (
                    <form action={markApplied.bind(null, r.id)}>
                      <button className="rounded-lg bg-[var(--border)] px-3 py-1.5 text-sm">I applied</button>
                    </form>
                  )}
                </div>
              </div>

              {r.status === "needs_user" && answers.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-[var(--muted)]">Answers the agent prepared (copy them into the form)</summary>
                  <dl className="mt-2 space-y-1">
                    {answers.slice(0, 30).map(([q, a]) => (
                      <div key={q}>
                        <dt className="text-xs text-[var(--muted)]">{q}</dt>
                        <dd>{String(a)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}

              {r.status !== "needs_user" && r.status !== "queued" && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-[var(--muted)]">Timeline & update status ({timeline.length})</summary>
                  <ol className="mt-2 space-y-1 border-l border-[var(--border)] pl-3">
                    {timeline.map((e, i) => (
                      <li key={i} className="text-xs">
                        <span className="text-[var(--muted)]">{new Date(e.created_at).toLocaleDateString()}</span> · {STAGE_LABEL[e.kind] ?? e.kind}
                        <span className="text-[var(--muted)]"> ({e.source === "email" ? "from your inbox" : e.source === "agent" ? "agent" : "you"})</span>
                        {e.detail ? ` — ${e.detail}` : ""}
                      </li>
                    ))}
                    {timeline.length === 0 && <li className="text-xs text-[var(--muted)]">No updates yet.</li>}
                  </ol>
                  <form action={setApplicationStatus.bind(null, r.id)} className="mt-3 flex flex-wrap gap-2">
                    <select name="status" defaultValue={r.status} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm">
                      {["submitted", "received", "under_review", "interview", "offer", "rejected", "withdrawn"].map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <input name="note" placeholder="Note (optional)" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm" />
                    <button className="rounded-lg bg-[var(--border)] px-3 py-1 text-sm">Save</button>
                  </form>
                </details>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
