import Link from "next/link";
import { requireUser } from "@/lib/v2/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { dismissJob, queueJob } from "../actions";

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
    salary_min: number | null;
    salary_max: number | null;
    verification_status: string;
    verification_signals: { code: string; points: number; message: string }[];
    posted_at: string | null;
  };
};

const LEVEL: Record<string, string> = { internship: "Internship", new_grad: "New grad", entry: "Entry", mid: "Mid", senior: "Senior" };
const pay = (a: number | null, b: number | null) =>
  b ? `$${Math.round((a ?? b) / 1000)}k${a && a !== b ? `–$${Math.round(b / 1000)}k` : ""}` : null;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string }> }) {
  const { show = "verified", q = "" } = await searchParams;
  const { supabase, user } = await requireUser();
  let query = supabase
    .from("jobs")
    .select("id,title,company_name,url,fit_score,fit_reasons, job_postings!inner(level,locations,is_remote,ats,salary_min,salary_max,verification_status,verification_signals,posted_at)")
    .eq("user_id", user.id)
    .eq("dismissed", false)
    .order("fit_score", { ascending: false })
    .limit(100);
  if (show === "verified") query = query.eq("job_postings.verification_status", "verified");
  if (show === "auto") query = query.eq("job_postings.verification_status", "verified").in("job_postings.ats", ["greenhouse", "lever", "ashby"]);
  const term = q.replace(/[,()%*]/g, " ").trim();
  if (term) query = query.or(`title.ilike.%${term}%,company_name.ilike.%${term}%`);
  const [{ data }, { data: apps }] = await Promise.all([query, supabase.from("applications").select("job_id,status").eq("user_id", user.id)]);
  const appBy = new Map((apps ?? []).map((a) => [a.job_id, a.status]));
  const rows = (data ?? []) as unknown as Row[];

  const tab = (v: string, label: string) => (
    <Link
      href={`/jobs?show=${v}${term ? `&q=${encodeURIComponent(term)}` : ""}`}
      className={`rounded-lg px-3 py-1.5 text-sm ${show === v ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="max-w-5xl">
      <PageHeader title="Matched jobs" description="Found automatically from your resume. Best matches first." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tab("verified", "Verified")}
        {tab("auto", "Agent can submit")}
        {tab("all", "All (incl. needs review)")}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="show" value={show} />
          <input name="q" defaultValue={term} placeholder="Search title or company" className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm" />
        </form>
      </div>
      {rows.length === 0 ? (
        <EmptyState message="No matches yet. Upload your resume on the Profile page — the agent finds jobs on its next run (every 3 hours)." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const p = r.job_postings;
            const status = appBy.get(r.id);
            const salary = pay(p.salary_min, p.salary_max);
            const v = p.verification_status;
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-[var(--accent)]">
                      {r.title}
                    </a>
                    <p className="text-sm text-[var(--muted)]">
                      {r.company_name} · {p.is_remote ? "Remote" : p.locations.slice(0, 2).join("; ")}
                      {salary ? ` · ${salary}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant={r.fit_score >= 75 ? "success" : r.fit_score >= 60 ? "warning" : "default"}>Fit {r.fit_score}</Badge>
                      <Badge variant={v === "verified" ? "success" : v === "review" ? "warning" : "danger"}>
                        {v === "verified" ? "Verified employer" : v === "review" ? "Needs review" : "Rejected"}
                      </Badge>
                      <Badge>{LEVEL[p.level] ?? p.level}</Badge>
                      {["greenhouse", "lever", "ashby"].includes(p.ats) && <Badge>Agent can submit</Badge>}
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
                        <button className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white">Apply</button>
                      </form>
                    )}
                    <form action={dismissJob.bind(null, r.id)}>
                      <button className="rounded-lg bg-[var(--border)] px-3 py-1.5 text-sm">Not for me</button>
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
