import Link from "next/link";
import { requireUser } from "@/lib/v2/session";
import { Badge, Button, Card, CompanyMark, EmptyState, FitBadge, PageHeader, buttonCls } from "@/components/ui";
import { Icon } from "@/components/sidebar";
import { ago, freshness, priorityScore } from "@/lib/v2/priority";
import { dismissJob, queueAllMatches, queueJob, toggleSavedJob } from "../actions";
import { agentCanSubmit, AUTO_SUBMIT_OR } from "@/lib/v2/verify";
import { stateLabel } from "@/lib/v2/overview";

export const dynamic = "force-dynamic";

type Posting = {
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
type Row = { id: string; title: string; company_name: string; url: string; fit_score: number; fit_reasons: string[]; job_postings: Posting };

const SELECT = "id,title,company_name,url,fit_score,fit_reasons, job_postings!inner(level,locations,is_remote,ats,apply_url,url,salary_min,salary_max,verification_status,verification_signals,posted_at)";
const LEVEL: Record<string, string> = { internship: "Internship", new_grad: "New grad", entry: "Entry", mid: "Mid", senior: "Senior" };
const pay = (a: number | null, b: number | null) => (b ? `$${Math.round((a ?? b) / 1000)}k${a && a !== b ? `–$${Math.round(b / 1000)}k` : ""}` : null);
const where = (p: Posting) => (p.is_remote ? "Remote" : p.locations.slice(0, 2).join("; ") || "Location not listed");
const ATS: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", workable: "Workable", rippling: "Rippling", jazzhr: "JazzHR", jobvite: "Jobvite", smartrecruiters: "SmartRecruiters" };

const SHOWS = [
  ["verified", "All matches"],
  ["remote", "Remote"],
  ["new", "Last 3 days"],
  ["auto", "Agent can submit"],
  ["saved", "Saved"],
  ["all", "Include unverified"],
] as const;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; sort?: string; queued?: string; job?: string; focus?: string }> }) {
  const sp = await searchParams;
  const show = SHOWS.some(([k]) => k === sp.show) ? sp.show! : "verified";
  const sort = sp.sort ?? "priority";
  const { supabase, user } = await requireUser();

  // Saved jobs need migration 011. Before it runs, this errors and the Saved filter/buttons stay hidden.
  const savedRes = await supabase.from("jobs").select("id").eq("user_id", user.id).not("saved_at", "is", null).limit(1000);
  const savedOn = !savedRes.error;
  const savedIds = new Set((savedRes.data ?? []).map((r) => r.id as string));

  let query = supabase.from("jobs").select(SELECT).eq("user_id", user.id).eq("dismissed", false).order("fit_score", { ascending: false }).limit(300);
  if (show !== "all" && show !== "saved") query = query.eq("job_postings.verification_status", "verified");
  if (show === "auto") query = query.or(AUTO_SUBMIT_OR, { referencedTable: "job_postings" });
  if (show === "remote") query = query.eq("job_postings.is_remote", true);
  if (show === "new") query = query.gte("job_postings.posted_at", new Date(Date.now() - 72 * 3600_000).toISOString());
  if (show === "saved") query = query.in("id", savedIds.size ? [...savedIds] : ["00000000-0000-0000-0000-000000000000"]);
  const term = (sp.q ?? "").replace(/[,()%*]/g, " ").trim();
  if (term) query = query.or(`title.ilike.%${term}%,company_name.ilike.%${term}%`);
  const [{ data, error }, { data: apps }] = await Promise.all([query, supabase.from("applications").select("id,job_id,status").eq("user_id", user.id)]);
  const appBy = new Map((apps ?? []).map((a) => [a.job_id as string, { id: a.id as string, status: a.status as string }]));
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

  // The job shown in the detail panel: the one in the URL (deep link), else the first result.
  let selected = rows.find((r) => r.id === sp.job) ?? null;
  if (!selected && sp.job) {
    const { data: one } = await supabase.from("jobs").select(SELECT).eq("user_id", user.id).eq("id", sp.job).maybeSingle();
    selected = (one as unknown as Row | null) ?? null;
  }
  const picked = Boolean(selected);
  selected ??= rows[0] ?? null;

  const ready = rows.filter((r) => !appBy.has(r.id) && agentCanSubmit(r.job_postings)).length;
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { show, sort, q: term || undefined, ...o };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "show" && v === "verified") && !(k === "sort" && v === "priority")) p.set(k, v);
    const s = p.toString();
    return `/jobs${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Job discovery"
        title="Find your next opportunity"
        description="Search, save and apply without leaving this screen. Matches come from your resume and the roles you picked."
        action={
          <Button href="/profile#roles" variant="secondary">
            <Icon name="settings" /> Matching preferences
          </Button>
        }
      />

      {sp.queued != null && (
        <p role="status" className="mb-4 rounded-xl bg-emerald-900/30 p-3 text-sm text-emerald-300">
          {Number(sp.queued) > 0 ? `Queued ${sp.queued} applications — a run is starting now and goes through them, freshest first.` : "Nothing new to queue: every match the agent can submit already has an application."}
        </p>
      )}

      {/* Search + filters */}
      <Card className="mb-5 p-4 sm:p-5">
        <form role="search" className="relative">
          <input type="hidden" name="show" value={show} />
          <input type="hidden" name="sort" value={sort} />
          <label htmlFor="job-search" className="sr-only">
            Search roles or companies
          </label>
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--muted)]" />
          <input
            id="job-search"
            name="q"
            defaultValue={term}
            autoFocus={sp.focus === "1"}
            placeholder="Search roles or companies…"
            className="h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--background-2)] pl-11 pr-28 text-[15px] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-text)]" aria-live="polite">
            {rows.length} {rows.length === 1 ? "match" : "matches"}
          </span>
        </form>
        <div className="no-scrollbar -mx-1 mt-3 flex items-center gap-2 overflow-x-auto px-1 pb-1">
          {SHOWS.filter(([k]) => k !== "saved" || savedOn).map(([k, label]) => (
            <Link
              key={k}
              href={qs({ show: k })}
              aria-current={show === k ? "true" : undefined}
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium transition ${
                show === k ? "border-transparent bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
              }`}
            >
              {k === "saved" && <Icon name="bookmark" className="h-3.5 w-3.5" />}
              {label}
              {k === "saved" && savedIds.size > 0 && <span className="tabular-nums">({savedIds.size})</span>}
            </Link>
          ))}
          <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-xs text-[var(--muted)]">
            Sort
            {[
              ["priority", "Priority"],
              ["newest", "Newest"],
              ["fit", "Best fit"],
            ].map(([v, l]) => (
              <Link
                key={v}
                href={qs({ sort: v })}
                aria-current={sort === v ? "true" : undefined}
                className={`rounded-lg px-2 py-1.5 ${sort === v ? "bg-[var(--hover)] font-semibold text-[var(--foreground)]" : "hover:text-[var(--foreground)]"}`}
              >
                {l}
              </Link>
            ))}
          </span>
        </div>
      </Card>

      {ready > 0 && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            <span className="font-semibold">{ready} matches</span> here can be submitted by the agent and haven’t been applied to yet.
          </p>
          <form action={queueAllMatches}>
            <button className={buttonCls("primary", "sm")}>Apply to all matches</button>
          </form>
        </Card>
      )}

      {error ? (
        <EmptyState icon="!" message="Couldn’t load your matches. Refresh the page to try again." />
      ) : rows.length === 0 && !selected ? (
        <EmptyState
          message={
            show === "saved"
              ? "Nothing saved yet. Use the bookmark on any job to keep it here."
              : term
                ? `No matches for “${term}”. Try another word or clear the search.`
                : "No matches here yet. Upload your resume and pick your roles — the agent finds jobs on its next run (every 2 hours)."
          }
          action={term ? <Button href={qs({ q: undefined })} variant="secondary" size="sm">Clear search</Button> : undefined}
        />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Results list (hidden on small screens while a job is open, so the detail reads like a sheet) */}
          <Card className={`overflow-hidden p-0! ${picked ? "hidden lg:block" : ""}`}>
            <ul aria-label="Job results">
              {rows.map((r) => {
                const p = r.job_postings;
                const isSel = selected?.id === r.id;
                const salary = pay(p.salary_min, p.salary_max);
                const app = appBy.get(r.id);
                return (
                  <li key={r.id} className={`relative border-b border-[var(--border)] last:border-b-0 ${isSel ? "bg-[var(--accent-soft)]/50" : ""}`}>
                    {isSel && <span className="absolute inset-y-0 left-0 w-1 bg-[var(--accent)]" aria-hidden />}
                    <div className="flex gap-3 p-4 sm:p-5">
                      <CompanyMark name={r.company_name} />
                      <Link href={qs({ job: r.id })} scroll={false} aria-current={isSel ? "true" : undefined} className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug hover:text-[var(--accent-text)]">{r.title}</p>
                        <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                          {r.company_name} · {where(p)}
                        </p>
                        {salary && <p className="mt-0.5 text-sm text-[var(--muted)]">{salary}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <FitBadge score={r.fit_score} />
                          <Badge>{LEVEL[p.level] ?? p.level}</Badge>
                          {freshness(p.posted_at, now).key === "today" && <Badge variant="success">New today</Badge>}
                          {p.verification_status !== "verified" && <Badge variant="warning">Unverified</Badge>}
                          {app && <Badge variant={stateLabel(app.status).tone}>{stateLabel(app.status).label}</Badge>}
                        </div>
                      </Link>
                      {savedOn && (
                        <form action={toggleSavedJob.bind(null, r.id, !savedIds.has(r.id))}>
                          <button
                            className={`grid h-10 w-10 place-items-center rounded-lg transition hover:bg-[var(--hover)] ${savedIds.has(r.id) ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)]"}`}
                            aria-pressed={savedIds.has(r.id)}
                            aria-label={savedIds.has(r.id) ? `Remove ${r.title} from saved` : `Save ${r.title}`}
                          >
                            <Icon name="bookmark" />
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Detail panel */}
          {selected && (
            <JobDetail job={selected} app={appBy.get(selected.id)} saved={savedIds.has(selected.id)} savedOn={savedOn} backHref={qs({ job: undefined })} picked={picked} now={now} />
          )}
        </div>
      )}
    </div>
  );
}

function JobDetail({ job, app, saved, savedOn, backHref, picked, now }: { job: Row; app?: { id: string; status: string }; saved: boolean; savedOn: boolean; backHref: string; picked: boolean; now: number }) {
  const p = job.job_postings;
  const salary = pay(p.salary_min, p.salary_max);
  const good = (p.verification_signals ?? []).filter((s) => s.points >= 0);
  const bad = (p.verification_signals ?? []).filter((s) => s.points < 0);
  const canSubmit = agentCanSubmit(p);
  const posted = ago(p.posted_at, now);
  const st = app ? stateLabel(app.status) : null;
  return (
    <Card className={`p-5 sm:p-6 lg:sticky lg:top-[100px] ${picked ? "" : "hidden lg:block"}`}>
      <section aria-labelledby="job-detail-title">
        <Link href={backHref} scroll={false} className="mb-4 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-[var(--accent-text)] lg:hidden">
          <Icon name="chevron" className="h-4 w-4 rotate-180" /> Back to results
        </Link>
        <CompanyMark name={job.company_name} size="lg" />
        <h2 id="job-detail-title" className="mt-4 text-xl font-bold leading-tight tracking-tight sm:text-2xl">
          {job.title}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {job.company_name} · {where(p)}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {salary && <Badge variant="accent">{salary}</Badge>}
          <FitBadge score={job.fit_score} />
          <Badge>{LEVEL[p.level] ?? p.level}</Badge>
          {posted && <Badge>Posted {posted}</Badge>}
          <Badge variant={p.verification_status === "verified" ? "success" : p.verification_status === "review" ? "warning" : "danger"}>
            {p.verification_status === "verified" ? "Verified employer" : p.verification_status === "review" ? "Employer not verified" : "Flagged"}
          </Badge>
        </div>

        <div className="mt-5 border-t border-[var(--border)] pt-5">
          <h3 className="font-semibold">Why this fits</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Fit is an estimate from your resume, roles, level and location — not your chance of getting the job.</p>
          <div className="mt-3 h-1.5 rounded-full bg-[var(--hover)]">
            <div className="h-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]" style={{ width: `${Math.max(4, Math.min(100, job.fit_score))}%` }} />
          </div>
          {job.fit_reasons?.length ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {job.fit_reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">No detailed reasons were recorded for this match.</p>
          )}
        </div>

        {(good.length > 0 || bad.length > 0) && (
          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <h3 className="font-semibold">Employer check</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {good.slice(0, 4).map((s, i) => (
                <li key={`g${i}`} className="flex gap-2 text-[var(--muted)]">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {s.message}
                </li>
              ))}
              {bad.map((s, i) => (
                <li key={`b${i}`} className="flex gap-2 text-red-400">
                  <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                  {s.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 space-y-2.5 border-t border-[var(--border)] pt-5">
          {app && st ? (
            <>
              <p className="text-sm">
                Application: <Badge variant={st.tone}>{st.label}</Badge>
              </p>
              <Link href={`/applications?app=${app.id}`} className={`${buttonCls("primary")} w-full min-h-[44px]`}>
                Open application <Icon name="arrow" className="h-4 w-4" />
              </Link>
            </>
          ) : p.verification_status === "verified" ? (
            <form action={queueJob.bind(null, job.id)}>
              <button className={`${buttonCls("primary")} w-full min-h-[44px]`}>
                {canSubmit ? "Apply with agent" : "Prepare application"} <Icon name="arrow" className="h-4 w-4" />
              </button>
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                {canSubmit
                  ? `Queues it: on its next run the agent fills in the ${ATS[p.ats] ?? "application"} form with your profile and submits it. You’ll see the result in Applications.`
                  : "The agent can’t submit on this site. It prepares your answers and puts it in Needs you so you can submit it yourself."}
              </p>
            </form>
          ) : (
            <p className="text-sm text-[var(--muted)]">This employer isn’t verified, so the agent won’t apply. You can still open the posting yourself.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a href={p.apply_url || job.url} target="_blank" rel="noopener noreferrer" className={`${buttonCls("secondary")} min-h-[44px]`}>
              Posting <Icon name="external" className="h-3.5 w-3.5" />
            </a>
            {savedOn ? (
              <form action={toggleSavedJob.bind(null, job.id, !saved)}>
                <button className={`${buttonCls("secondary")} min-h-[44px] w-full`} aria-pressed={saved}>
                  <Icon name="bookmark" /> {saved ? "Saved" : "Save for later"}
                </button>
              </form>
            ) : (
              <form action={dismissJob.bind(null, job.id)}>
                <button className={`${buttonCls("ghost")} min-h-[44px] w-full`}>Not for me</button>
              </form>
            )}
          </div>
          {savedOn && !app && (
            <form action={dismissJob.bind(null, job.id)} className="text-center">
              <button className="min-h-[36px] text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:underline">Not for me — hide this job</button>
            </form>
          )}
          <p className="text-xs text-[var(--muted)]">Source: {ATS[p.ats] ?? p.ats ?? "job board"}</p>
        </div>
      </section>
    </Card>
  );
}
