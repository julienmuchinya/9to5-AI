import { requireUser } from "@/lib/v2/session";
import { Badge, Card, EmptyState, PageHeader, TabLink, buttonCls } from "@/components/ui";
import { ago, freshness, priorityScore } from "@/lib/v2/priority";
import { dismissJob, queueAllMatches, queueJob } from "../actions";
import { agentCanSubmit, AUTO_SUBMIT_OR } from "@/lib/v2/verify";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string;
  company_name: string;
  url: string;
  fit_score: number;
  fit_reasons: string[];
  job_postings: {
    level: string;
    locations: string[];
    is_remote: boolean;
    ats: string;
    apply_url: string | null;
    url: string;
    salary_min: number | null;
    salary_max: number | null;
    verification_status: string;
    verification_signals: { code: string; points: number; message: string }[];
    posted_at: string | null;
  };
};

const LEVEL: Record<string, string> = { internship: "Internship", new_grad: "New grad", entry: "Entry", mid: "Mid", senior: "Senior" };
const pay = (a: number | null, b: number | null) => (b ? `$${Math.round((a ?? b) / 1000)}k${a && a !== b ? `–$${Math.round(b / 1000)}k` : ""}` : null);
const FRESH_VARIANT = { today: "success", "2d": "info", "3d": "info", week: "default", "2weeks": "default", older: "default", unknown: "default" } as const;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; sort?: string; queued?: string }> }) {
  const { show = "verified", q = "", sort = "priority", queued } = await searchParams;
  const { supabase, user } = await requireUser();
  let query = supabase
    .from("jobs")
    .select("id,title,company_name,url,fit_score,fit_reasons, job_postings!inner(level,locations,is_remote,ats,apply_url,url,salary_min,salary_max,verification_status,verification_signals,posted_at)")
    .eq("user_id", user.id)
    .eq("dismissed", false)
    .order("fit_score", { ascending: false })
    .limit(300);
  if (show === "verified" || show === "new") query = query.eq("job_postings.verification_status", "verified");
  if (show === "auto") query = query.eq("job_postings.verification_status", "verified").or(AUTO_SUBMIT_OR, { referencedTable: "job_postings" });
  if (show === "new") query = query.gte("job_postings.posted_at", new Date(Date.now() - 72 * 3600_000).toISOString());
  const term = q.replace(/[,()%*]/g, " ").trim();
  if (term) query = query.or(`title.ilike.%${term}%,company_name.ilike.%${term}%`);
  const [{ data }, { data: apps }] = await Promise.all([query, supabase.from("applications").select("job_id,status").eq("user_id", user.id)]);
  const appBy = new Map((apps ?? []).map((a) => [a.job_id, a.status]));
  const now = Date.now();
  const rows = ((data ?? []) as unknown as Row[])
    .sort((a, b) =>
      sort === "fit"
        ? b.fit_score - a.fit_score
        : sort === "newest"
          ? Date.parse(b.job_postings.posted_at ?? "0") - Date.parse(a.job_postings.posted_at ?? "0")
          : priorityScore(b.fit_score, b.job_postings.posted_at, now) - priorityScore(a.fit_score, a.job_postings.posted_at, now)
    )
    .slice(0, 120);

  const ready = rows.filter((r) => !appBy.has(r.id) && agentCanSubmit(r.job_postings)).length;

  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ show, sort, ...(term ? { q: term } : {}), ...o });
    return `/jobs?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Discovery"
        title="Matched jobs"
        description="Found automatically from your resume. Ranked by priority: fit score plus a big boost for postings from the last 24 hours, then 2–3 days, then this week."
      />
      {queued != null && (
        <p className="mb-4 rounded-lg bg-emerald-900/30 p-3 text-sm text-emerald-300">
          {Number(queued) > 0 ? `Queued ${queued} applications — a run is starting now and goes through them, freshest first.` : "Nothing new to queue: every match the agent can submit already has an application."}
        </p>
      )}
      {ready > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            <span className="font-medium">{ready} matches</span> on this page can be submitted by the agent and haven’t been applied to yet.
          </p>
          <form action={queueAllMatches}>
            <button className={buttonCls("primary", "sm")}>Apply to all matches</button>
          </form>
        </Card>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <TabLink href={qs({ show: "verified" })} active={show === "verified"}>Verified</TabLink>
        <TabLink href={qs({ show: "new" })} active={show === "new"}>🔥 Last 3 days</TabLink>
        <TabLink href={qs({ show: "auto" })} active={show === "auto"}>Agent can submit</TabLink>
        <TabLink href={qs({ show: "all" })} active={show === "all"}>All</TabLink>
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="show" value={show} />
          <input type="hidden" name="sort" value={sort} />
          <input
            name="q"
            defaultValue={term}
            placeholder="Search title or company"
            className="w-56 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
          />
        </form>
      </div>
      <div className="mb-5 flex items-center gap-1 text-xs text-[var(--muted)]">
        Sort:
        {[
          ["priority", "Priority"],
          ["newest", "Newest"],
          ["fit", "Best fit"],
        ].map(([v, l]) => (
          <TabLink key={v} href={qs({ sort: v })} active={sort === v}>
            {l}
          </TabLink>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState message="No matches here yet. Upload your resume on the Profile page — the agent finds jobs on its next run (every 2 hours)." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const p = r.job_postings;
            const status = appBy.get(r.id);
            const salary = pay(p.salary_min, p.salary_max);
            const v = p.verification_status;
            const f = freshness(p.posted_at, now);
            return (
              <Card key={r.id} className="p-4 transition hover:border-[var(--border-strong)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-[var(--accent)]">
                      {r.title}
                    </a>
                    <p className="mt-0.5 text-sm text-[var(--muted)]">
                      {r.company_name} · {p.is_remote ? "Remote" : p.locations.slice(0, 2).join("; ")}
                      {salary ? ` · ${salary}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant={FRESH_VARIANT[f.key]}>{f.key === "today" ? "🔥 " : ""}{ago(p.posted_at, now) ? `Posted ${ago(p.posted_at, now)}` : f.label}</Badge>
                      <Badge variant={r.fit_score >= 75 ? "success" : r.fit_score >= 60 ? "warning" : "default"}>Fit {r.fit_score}</Badge>
                      <Badge variant={v === "verified" ? "success" : v === "review" ? "warning" : "danger"}>
                        {v === "verified" ? "✓ Verified employer" : v === "review" ? "Needs review" : "Rejected"}
                      </Badge>
                      <Badge>{LEVEL[p.level] ?? p.level}</Badge>
                      {agentCanSubmit(p) ? <Badge variant="accent">Agent can submit</Badge> : <Badge>Apply yourself</Badge>}
                      {status && <Badge variant="warning">Application: {status.replace("_", " ")}</Badge>}
                    </div>
                    {r.fit_reasons?.length > 0 && <p className="mt-2 text-xs text-[var(--muted)]">{r.fit_reasons.join(" · ")}</p>}
                    <details className="mt-1 text-xs text-[var(--muted)]">
                      <summary className="cursor-pointer">Why we trust this posting</summary>
                      <ul className="mt-1 list-disc pl-5">
                        {(p.verification_signals ?? []).map((s, i) => (
                          <li key={i} className={s.points < 0 ? "text-red-400" : ""}>
                            {s.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!status && v === "verified" && (
                      <form action={queueJob.bind(null, r.id)}>
                        <button className={buttonCls("primary", "sm")}>Apply</button>
                      </form>
                    )}
                    <form action={dismissJob.bind(null, r.id)}>
                      <button className={buttonCls("ghost", "sm")}>Not for me</button>
                    </form>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
