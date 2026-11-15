import Link from "next/link";
import { Suspense } from "react";
import { liveSearch } from "@/lib/v2/discovery/live-search";
import { requireUser } from "@/lib/v2/session";
import { Badge, CompanyMark, Emphasis, EmptyState, FitBadge, PageHeader, buttonCls, inputCls } from "@/components/ui";
import { loadLibrary } from "@/lib/v2/resume-library";
import { PrepareDialog } from "./prepare-dialog";
import { Icon } from "@/components/sidebar";
import { ago, freshness, priorityScore } from "@/lib/v2/priority";
import { addSearchedJob, dismissJob, queueAllMatches, toggleSavedJob } from "../actions";
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

// Live web search can take a few seconds; it streams in after the rest of the page.
export const maxDuration = 30;

const POSTED: [string, string][] = [
  ["", "Any time"],
  ["1", "Last 24 hours"],
  ["3", "Last 3 days"],
  ["7", "Last week"],
  ["14", "Last 2 weeks"],
  ["30", "Last month"],
];
const PAY: [string, string][] = [
  ["", "Any pay"],
  ["40000", "$40k+"],
  ["60000", "$60k+"],
  ["80000", "$80k+"],
  ["100000", "$100k+"],
  ["150000", "$150k+"],
];

type SP = {
  show?: string;
  q?: string;
  sort?: string;
  queued?: string;
  job?: string;
  focus?: string;
  scope?: string;
  posted?: string;
  level?: string;
  minpay?: string;
  loc?: string;
  src?: string;
  msg?: string;
  added?: string;
};

type DbPosting = Posting & { id: string; title: string; company_name: string };

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const show = SHOWS.some(([k]) => k === sp.show) && !(scope === "all" && sp.show === "saved") ? sp.show! : "verified";
  const sort = sp.sort ?? (scope === "all" ? "newest" : "priority");
  const term = (sp.q ?? "").replace(/[,()%*]/g, " ").trim().slice(0, 100);
  // Extra filters (the "More filters" panel).
  const posted = POSTED.some(([v]) => v === sp.posted) ? (sp.posted ?? "") : "";
  const level = sp.level && sp.level in LEVEL ? sp.level : "";
  const minpay = PAY.some(([v]) => v === sp.minpay) ? (sp.minpay ?? "") : "";
  const loc = (sp.loc ?? "").replace(/[^\w\s,.-]/g, "").trim().slice(0, 60);
  const src = sp.src && sp.src in ATS ? sp.src : "";
  const extra = [posted, level, minpay, loc, src].filter(Boolean).length;
  const { supabase, user } = await requireUser();

  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { scope, show, sort, q: term || undefined, posted, level, minpay, loc, src, ...o };
    for (const [k, v] of Object.entries(merged)) {
      if (!v) continue;
      if (k === "scope" && v === "mine") continue;
      if (k === "show" && v === "verified") continue;
      if (k === "sort" && v === ((merged.scope ?? scope) === "all" ? "newest" : "priority")) continue;
      p.set(k, v);
    }
    const s = p.toString();
    return `/jobs${s ? `?${s}` : ""}`;
  };
  const here = qs({});
  const sinceIso = posted ? new Date(Date.now() - Number(posted) * 86400_000).toISOString() : show === "new" ? new Date(Date.now() - 72 * 3600_000).toISOString() : "";
  const locOk = (p: { is_remote: boolean; locations: string[] }) => !loc || where(p as Posting).toLowerCase().includes(loc.toLowerCase());

  // Saved jobs need migration 011. Before it runs, this errors and the Saved filter/buttons stay hidden.
  const savedRes = await supabase.from("jobs").select("id").eq("user_id", user.id).not("saved_at", "is", null).limit(1000);
  const savedOn = !savedRes.error;
  const savedIds = new Set((savedRes.data ?? []).map((r) => r.id as string));
  const now = Date.now();

  // ── My matches ─────────────────────────────────────────────────────────
  let rows: Row[] = [];
  let all: DbPosting[] = [];
  let mineByPosting = new Map<string, string>();
  let error: unknown = null;
  let appBy = new Map<string, { id: string; status: string }>();
  if (scope === "mine") {
    let query = supabase.from("jobs").select(SELECT).eq("user_id", user.id).eq("dismissed", false).order("fit_score", { ascending: false }).limit(400);
    if (show !== "all" && show !== "saved") query = query.eq("job_postings.verification_status", "verified");
    if (show === "auto") query = query.or(AUTO_SUBMIT_OR, { referencedTable: "job_postings" });
    if (show === "remote") query = query.eq("job_postings.is_remote", true);
    if (sinceIso) query = query.gte("job_postings.posted_at", sinceIso);
    if (level) query = query.eq("job_postings.level", level);
    if (minpay) query = query.gte("job_postings.salary_max", Number(minpay));
    if (src) query = query.eq("job_postings.ats", src);
    if (show === "saved") query = query.in("id", savedIds.size ? [...savedIds] : ["00000000-0000-0000-0000-000000000000"]);
    if (term) query = query.or(`title.ilike.%${term}%,company_name.ilike.%${term}%`);
    const [res, { data: apps }] = await Promise.all([query, supabase.from("applications").select("id,job_id,status").eq("user_id", user.id)]);
    error = res.error;
    appBy = new Map((apps ?? []).map((a) => [a.job_id as string, { id: a.id as string, status: a.status as string }]));
    rows = ((res.data ?? []) as unknown as Row[])
      .filter((r) => locOk(r.job_postings))
      .sort((a, b) =>
        sort === "fit"
          ? b.fit_score - a.fit_score
          : sort === "newest"
            ? Date.parse(b.job_postings.posted_at ?? "0") - Date.parse(a.job_postings.posted_at ?? "0")
            : priorityScore(b.fit_score, b.job_postings.posted_at, now) - priorityScore(a.fit_score, a.job_postings.posted_at, now)
      )
      .slice(0, 150);
  } else {
    // ── All jobs: every posting the agent has found, for anyone, in any field ──
    let query = supabase
      .from("job_postings")
      .select("id,source,source_key,title,company_name,locations,is_remote,salary_min,salary_max,posted_at,level,ats,url,apply_url,verification_status")
      .eq("active", true)
      .neq("verification_status", "rejected")
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(250);
    if (show !== "all") query = query.eq("verification_status", "verified");
    if (show === "auto") query = query.or(AUTO_SUBMIT_OR);
    if (show === "remote") query = query.eq("is_remote", true);
    if (sinceIso) query = query.gte("posted_at", sinceIso);
    if (level) query = query.eq("level", level);
    if (minpay) query = query.gte("salary_max", Number(minpay));
    if (src) query = query.eq("ats", src);
    if (term) query = query.or(`title.ilike.%${term}%,company_name.ilike.%${term}%`);
    const res = await query;
    error = res.error;
    all = ((res.data ?? []) as unknown as DbPosting[]).filter(locOk);
    if (sort === "company") all.sort((a, b) => a.company_name.localeCompare(b.company_name));
    const ids = all.map((p) => p.id);
    const { data: mine } = ids.length ? await supabase.from("jobs").select("id,posting_id").eq("user_id", user.id).in("posting_id", ids) : { data: [] };
    mineByPosting = new Map((mine ?? []).map((j) => [j.posting_id as string, j.id as string]));
  }

  // The job shown in the detail panel: the one in the URL (deep link), else the first result.
  let selected = rows.find((r) => r.id === sp.job) ?? null;
  if (!selected && sp.job) {
    const { data: one } = await supabase.from("jobs").select(SELECT).eq("user_id", user.id).eq("id", sp.job).maybeSingle();
    selected = (one as unknown as Row | null) ?? null;
    if (selected && !appBy.size) {
      const { data: a } = await supabase.from("applications").select("id,job_id,status").eq("user_id", user.id).eq("job_id", selected.id).maybeSingle();
      if (a) appBy.set(a.job_id as string, { id: a.id as string, status: a.status as string });
    }
  }
  const picked = Boolean(selected);
  if (scope === "mine") selected ??= rows[0] ?? null;

  const ready = rows.filter((r) => !appBy.has(r.id) && agentCanSubmit(r.job_postings)).length;
  const count = scope === "mine" ? rows.length : all.length;
  const chips = SHOWS.filter(([k]) => (k !== "saved" || (savedOn && scope === "mine")));

  // How many resumes the agent can choose from (shown in the Prepare dialog).
  let resumeCount = 0;
  if (selected) {
    const { data: rp } = await supabase.from("profiles").select("resume_path,resume_updated_at").eq("id", user.id).maybeSingle();
    resumeCount = (await loadLibrary(supabase, user.id, { resume_path: rp?.resume_path ?? null, resume_parsed: null, resume_updated_at: rp?.resume_updated_at ?? null }).catch(() => ({ resumes: [] }))).resumes.length;
  }

  const chipCls = (on: boolean) =>
    `inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm transition ${
      on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)] bg-[var(--card)] hover:border-[var(--foreground)]"
    }`;

  return (
    <div>
      <PageHeader
        eyebrow={scope === "mine" ? "Explore / your next chapter" : "Explore / every role we’ve found"}
        aside={scope === "mine" ? "A curated feed" : "The whole archive"}
        title="Good work, *ahead.*"
        description="Opportunities worth considering. Select a role to read the whole story."
        action={
          <Link href="/profile#roles" className="inline-flex min-h-[48px] items-center border border-[var(--border-strong)] bg-[var(--card)] px-4 text-sm font-semibold hover:border-[var(--foreground)]">
            Edit what you’re looking for ↗
          </Link>
        }
      />

      {sp.queued != null && (
        <p role="status" className="mb-6 border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
          {Number(sp.queued) > 0 ? `Queued ${sp.queued} applications — a run is starting now and goes through them, freshest first.` : "Nothing new to queue: every match the agent can submit already has an application."}
        </p>
      )}
      {sp.added && (
        <p role="status" className="mb-6 border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
          Added to your roles. It’s open below — save it or prepare an application.
        </p>
      )}
      {sp.msg && (
        <p role="alert" className="mb-6 border-l-[3px] border-red-400 bg-red-900/60 px-4 py-3 text-sm text-red-200">
          {sp.msg}
        </p>
      )}

      {/* Scope + search */}
      <div className="mb-6 inline-flex border border-[var(--border-strong)]" role="tablist" aria-label="What to search">
        {(
          [
            ["mine", "My matches"],
            ["all", "All roles we’ve found"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            role="tab"
            aria-selected={scope === k}
            href={qs({ scope: k, job: undefined, show: show === "saved" ? undefined : show, sort: undefined })}
            className={`min-h-[40px] px-4 py-2.5 text-sm transition ${scope === k ? "bg-[var(--accent)] font-semibold text-white" : "hover:bg-[var(--hover)]"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <form role="search" className="relative max-w-[820px]">
        <input type="hidden" name="scope" value={scope === "all" ? "all" : ""} />
        <input type="hidden" name="show" value={show === "verified" ? "" : show} />
        <input type="hidden" name="sort" value={sp.sort ?? ""} />
        {posted && <input type="hidden" name="posted" value={posted} />}
        {level && <input type="hidden" name="level" value={level} />}
        {minpay && <input type="hidden" name="minpay" value={minpay} />}
        {loc && <input type="hidden" name="loc" value={loc} />}
        {src && <input type="hidden" name="src" value={src} />}
        <label htmlFor="job-search" className="sr-only">
          Search by title, company or skill
        </label>
        <Icon name="search" className="pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2" />
        <input
          id="job-search"
          name="q"
          defaultValue={term}
          autoFocus={sp.focus === "1"}
          placeholder="Try a title, company, or skill"
          className="h-16 w-full border-0 border-b-2 border-[var(--foreground)] bg-transparent pl-9 pr-28 font-serif text-[22px] outline-none placeholder:text-[var(--muted)]/70 focus:border-[var(--orange)] sm:text-[28px]"
        />
        <span className="kicker absolute right-0 top-1/2 -translate-y-1/2" aria-live="polite">
          {count} {scope === "mine" ? (count === 1 ? "match" : "matches") : count === 1 ? "role" : "roles"}
        </span>
      </form>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="no-scrollbar -mx-1 flex max-w-full items-center gap-2 overflow-x-auto px-1">
          <span className="kicker mr-1 shrink-0">Show me</span>
          {chips.map(([k, label]) => (
            <Link key={k} href={qs({ show: k, job: undefined })} aria-current={show === k ? "true" : undefined} className={chipCls(show === k)}>
              {k === "saved" && <span aria-hidden>♡</span>}
              {k === "verified" ? (scope === "all" ? "Verified employers" : "All roles") : label}
              {k === "saved" && savedIds.size > 0 && <span className="font-mono text-xs">{savedIds.size}</span>}
            </Link>
          ))}
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-sm">
          <span className="kicker mr-1">Sort</span>
          {(scope === "mine"
            ? [
                ["priority", "Priority"],
                ["newest", "Newest"],
                ["fit", "Best fit"],
              ]
            : [
                ["newest", "Newest"],
                ["company", "Company"],
              ]
          ).map(([v, l]) => (
            <Link key={v} href={qs({ sort: v })} aria-current={sort === v ? "true" : undefined} className={`min-h-[36px] px-2 py-1.5 ${sort === v ? "font-semibold underline underline-offset-4" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}>
              {l}
            </Link>
          ))}
        </span>
      </div>

      {/* More preferences */}
      <details className="no-marker mt-4" open={extra > 0}>
        <summary className="inline-flex min-h-[40px] cursor-pointer items-center text-sm font-semibold underline underline-offset-4">More preferences{extra ? ` (${extra} on)` : ""} ↗</summary>
        <form className="mt-4 grid gap-4 border-t border-[var(--border)] pt-5 sm:grid-cols-2 lg:grid-cols-5">
          <input type="hidden" name="scope" value={scope === "all" ? "all" : ""} />
          <input type="hidden" name="show" value={show === "verified" ? "" : show} />
          <input type="hidden" name="sort" value={sp.sort ?? ""} />
          <input type="hidden" name="q" value={term} />
          <label className="kicker block">
            Date posted
            <select name="posted" defaultValue={posted} className={`${inputCls} min-h-[44px] font-sans normal-case tracking-normal`}>
              {POSTED.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="kicker block">
            Experience level
            <select name="level" defaultValue={level} className={`${inputCls} min-h-[44px] font-sans normal-case tracking-normal`}>
              <option value="">Any level</option>
              {Object.entries(LEVEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="kicker block">
            Minimum pay
            <select name="minpay" defaultValue={minpay} className={`${inputCls} min-h-[44px] font-sans normal-case tracking-normal`}>
              {PAY.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="kicker block">
            Location contains
            <input name="loc" defaultValue={loc} placeholder="Texas, Houston, Remote…" className={`${inputCls} min-h-[44px] font-sans normal-case tracking-normal`} />
          </label>
          <label className="kicker block">
            Job site
            <select name="src" defaultValue={src} className={`${inputCls} min-h-[44px] font-sans normal-case tracking-normal`}>
              <option value="">Any site</option>
              {Object.entries(ATS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
            <button className={buttonCls("primary")}>Apply preferences</button>
            {extra > 0 && (
              <Link href={qs({ posted: undefined, level: undefined, minpay: undefined, loc: undefined, src: undefined })} className={buttonCls("ghost")}>
                Clear
              </Link>
            )}
            {minpay && <span className="text-xs text-[var(--muted)]">Minimum pay hides roles that don’t list pay.</span>}
          </div>
        </form>
      </details>

      {scope === "mine" && ready > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold">{ready} roles</span> here can be submitted by the agent and haven’t been applied to yet.
          </p>
          <form action={queueAllMatches}>
            <button className={buttonCls("primary", "sm")}>Queue all of them</button>
          </form>
        </div>
      )}

      <div className="mt-6">
        {error ? (
          <EmptyState icon="!" message="We couldn’t load roles. Your search is safe — refresh the page to try again." />
        ) : scope === "all" ? (
          all.length === 0 ? (
            <EmptyState title="Nothing here right now." message={term ? `No saved roles match “${term}”. The live results below search job sites too.` : "No roles match these filters."} action={extra ? <Link href={qs({ posted: undefined, level: undefined, minpay: undefined, loc: undefined, src: undefined })} className={buttonCls("primary")}>Clear filters</Link> : undefined} />
          ) : (
            <div className="border-t-2 border-[var(--foreground)]">
              <p className="kicker flex justify-between border-b border-[var(--border)] py-3">
                <span>
                  {String(all.length).padStart(2, "0")} roles in this view{all.length >= 250 ? " · newest 250 — add a word or filter to narrow it" : ""}
                </span>
                <span className="hidden sm:inline">Add to explore ↗</span>
              </p>
              <ul aria-label="All roles">
                {all.map((p) => {
                  const mineId = mineByPosting.get(p.id);
                  const salary = pay(p.salary_min ?? null, p.salary_max ?? null);
                  const age = ago(p.posted_at, now);
                  return (
                    <li key={p.id} className="flex flex-wrap items-start gap-4 border-b border-[var(--border)] py-5 sm:flex-nowrap">
                      <CompanyMark name={p.company_name} />
                      <div className="min-w-0 flex-1">
                        <p className="kicker">{p.company_name}</p>
                        <p className="mt-0.5 text-[17px] font-semibold leading-snug">{p.title}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {where(p as Posting)} · {salary ?? "Pay not listed"}
                          {age ? ` · ${age}` : ""}
                          {p.verification_status !== "verified" ? " · employer not verified" : ""}
                        </p>
                      </div>
                      <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                        <a href={p.apply_url || p.url} target="_blank" rel="noopener noreferrer" className={buttonCls("ghost", "sm")}>
                          Posting ↗
                        </a>
                        {mineId ? (
                          <Link href={qs({ scope: "mine", job: mineId, show: "all", q: undefined, sort: undefined })} className={buttonCls("secondary", "sm")}>
                            Open role →
                          </Link>
                        ) : (
                          <form action={addSearchedJob}>
                            <input type="hidden" name="posting_id" value={p.id} />
                            <input type="hidden" name="back" value={here} />
                            <button className={buttonCls("primary", "sm")}>+ Add to explore</button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )
        ) : rows.length === 0 && !selected ? (
          <EmptyState
            title="Nothing here right now."
            message={
              show === "saved"
                ? "Nothing saved yet. Tap ♡ on any role to keep it here."
                : term
                  ? `None of your matches mention “${term}”. Try every role we’ve found, or the live results below.`
                  : "No matches yet. Add your resume and the work you want — the agent finds roles on its next run, about every two hours."
            }
            action={
              term ? (
                <Link href={qs({ scope: "all", show: undefined, sort: undefined })} className={buttonCls("primary")}>
                  Search every role for “{term}”
                </Link>
              ) : extra ? (
                <Link href={qs({ posted: undefined, level: undefined, minpay: undefined, loc: undefined, src: undefined })} className={buttonCls("primary")}>
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid items-start border-t-2 border-[var(--foreground)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            {/* Results (hidden on small screens while a role is open, so the brief reads like a sheet) */}
            <div className={`lg:border-r lg:border-[var(--border)] ${picked ? "hidden lg:block" : ""}`}>
              <p className="kicker flex justify-between border-b border-[var(--border)] py-3 lg:pr-5">
                <span>{String(rows.length).padStart(2, "0")} roles in your current view</span>
                <span className="hidden sm:inline">Select to explore ↗</span>
              </p>
              <ul aria-label="Roles">
                {rows.map((r) => {
                  const p = r.job_postings;
                  const isSel = selected?.id === r.id;
                  const salary = pay(p.salary_min, p.salary_max);
                  const app = appBy.get(r.id);
                  return (
                    <li key={r.id} className={`relative border-b border-[var(--border)] ${isSel ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}>
                      {isSel && <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--orange)]" aria-hidden />}
                      <div className="flex gap-4 py-5 pl-3 pr-3 lg:pr-5">
                        <CompanyMark name={r.company_name} />
                        <Link href={qs({ job: r.id })} scroll={false} aria-current={isSel ? "true" : undefined} className="min-w-0 flex-1">
                          <p className="kicker">{r.company_name}</p>
                          <p className="mt-0.5 text-[17px] font-semibold leading-snug">{r.title}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {where(p)} · {salary ?? "Pay not listed"}
                            {freshness(p.posted_at, now).key === "today" ? " · new today" : ""}
                          </p>
                          {(app || p.verification_status !== "verified") && (
                            <p className="mt-2 flex flex-wrap gap-1.5">
                              {p.verification_status !== "verified" && <Badge variant="warning">Not verified</Badge>}
                              {app && <Badge variant={stateLabel(app.status).tone}>{stateLabel(app.status).label}</Badge>}
                            </p>
                          )}
                        </Link>
                        <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                          <FitBadge score={r.fit_score} />
                          {savedOn && (
                            <form action={toggleSavedJob.bind(null, r.id, !savedIds.has(r.id))}>
                              <button
                                className={`grid h-10 w-10 place-items-center text-xl hover:bg-[var(--hover)] ${savedIds.has(r.id) ? "text-[var(--orange)]" : "text-[var(--muted)]"}`}
                                aria-pressed={savedIds.has(r.id)}
                                aria-label={savedIds.has(r.id) ? `Remove ${r.title} from saved` : `Save ${r.title}`}
                              >
                                {savedIds.has(r.id) ? "♥" : "♡"}
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
                {rows.length === 0 && <li className="py-5 text-sm text-[var(--muted)]">No other roles with these filters.</li>}
              </ul>
            </div>

            {selected && <JobDetail job={selected} app={appBy.get(selected.id)} saved={savedIds.has(selected.id)} savedOn={savedOn} backHref={qs({ job: undefined })} picked={picked} now={now} resumes={resumeCount} />}
          </div>
        )}
      </div>

      {/* Live results from job sites, streamed in after everything above. */}
      {term && (
        <Suspense
          fallback={
            <section className="mt-14 border-t-2 border-[var(--foreground)] pt-6" aria-busy="true">
              <h2 className="display text-[30px]">Further afield.</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Searching job sites and 60+ employers for “{term}”…</p>
              <div className="mt-5 space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse bg-[var(--hover)]" />
                ))}
              </div>
            </section>
          }
        >
          <WebResults term={term} back={here} sinceIso={sinceIso} remoteOnly={show === "remote"} minpay={Number(minpay) || 0} loc={loc} userId={user.id} />
        </Suspense>
      )}
    </div>
  );
}

/** Live search results (job sites + employer career sites), with "Add to explore". */
async function WebResults({ term, back, sinceIso, remoteOnly, minpay, loc, userId }: { term: string; back: string; sinceIso: string; remoteOnly: boolean; minpay: number; loc: string; userId: string }) {
  const { supabase } = await requireUser();
  const { hits, failed } = await liveSearch(term, { timeoutMs: 8000 });
  const shown = hits.filter(
    (h) =>
      (!sinceIso || !h.posted_at || h.posted_at >= sinceIso) &&
      (!remoteOnly || h.is_remote) &&
      (!minpay || (h.salary_max ?? 0) >= minpay) &&
      (!loc || h.location.toLowerCase().includes(loc.toLowerCase()))
  );
  const keys = shown.slice(0, 80).map((h) => h.key);
  const { data: mine } = keys.length ? await supabase.from("jobs").select("id,idempotency_key").eq("user_id", userId).in("idempotency_key", keys) : { data: [] };
  const have = new Map((mine ?? []).map((j) => [j.idempotency_key as string, j.id as string]));
  const SRC: Record<string, string> = { remotive: "Remotive", jobicy: "Jobicy", workday: "Employer site" };
  return (
    <section className="mt-14 border-t-2 border-[var(--foreground)] pt-6" aria-labelledby="web-results">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="web-results" className="display text-[30px]">
          Further <Emphasis text="*afield.*" />
        </h2>
        <p className="kicker">{shown.length} live result{shown.length === 1 ? "" : "s"}</p>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
        {shown.length ? `Live results for “${term}”` : `No live results for “${term}”`} from Remotive, Jobicy and 60+ employers’ career sites — energy, healthcare, banking, retail, government and tech. They aren’t checked yet: adding one runs the employer check and describes the fit against your profile.
        {failed.length ? ` (${failed.join(", ")} didn’t answer in time.)` : ""}
      </p>
      {shown.length > 0 && (
        <ul aria-label="Live results" className="mt-4 border-t border-[var(--border)]">
          {shown.slice(0, 80).map((h) => {
            const mineId = have.get(h.key);
            const age = h.posted_label ?? ago(h.posted_at);
            const salary = pay(h.salary_min ?? null, h.salary_max ?? null);
            return (
              <li key={h.key} className="flex flex-wrap items-start gap-4 border-b border-[var(--border)] py-5 sm:flex-nowrap">
                <CompanyMark name={h.company} />
                <div className="min-w-0 flex-1">
                  <p className="kicker">
                    {h.company} · {SRC[h.source]}
                  </p>
                  <p className="mt-0.5 text-[17px] font-semibold leading-snug">{h.title}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {h.location} · {salary ?? "Pay not listed"}
                    {age ? ` · posted ${age}` : ""}
                  </p>
                </div>
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                  <a href={h.url} target="_blank" rel="noopener noreferrer" className={buttonCls("ghost", "sm")}>
                    Posting ↗
                  </a>
                  {mineId ? (
                    <Link href={`/jobs?job=${mineId}&show=all`} className={buttonCls("secondary", "sm")}>
                      Open role →
                    </Link>
                  ) : (
                    <form action={addSearchedJob}>
                      <input type="hidden" name="live_key" value={h.key} />
                      <input type="hidden" name="term" value={term} />
                      <input type="hidden" name="back" value={back} />
                      <button className={buttonCls("primary", "sm")}>+ Add to explore</button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The position brief: desktop right pane, full-screen sheet on phones. */
function JobDetail({ job, app, saved, savedOn, backHref, picked, now, resumes }: { job: Row; app?: { id: string; status: string }; saved: boolean; savedOn: boolean; backHref: string; picked: boolean; now: number; resumes: number }) {
  const p = job.job_postings;
  const salary = pay(p.salary_min, p.salary_max);
  const good = (p.verification_signals ?? []).filter((s) => s.points >= 0);
  const bad = (p.verification_signals ?? []).filter((s) => s.points < 0);
  const canSubmit = agentCanSubmit(p);
  const posted = ago(p.posted_at, now);
  const st = app ? stateLabel(app.status) : null;
  const reasons = (job.fit_reasons ?? []).filter((r) => !/^added by you/i.test(r));
  return (
    // Sticky on desktop, with its own scroll so a long brief can be read without scrolling the whole page first.
    <section
      aria-labelledby="job-detail-title"
      className={`bg-[var(--card-2)] px-1 py-6 sm:px-8 lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:overscroll-contain lg:px-10 lg:py-9 ${picked ? "" : "hidden lg:block"}`}
    >
      <Link href={backHref} scroll={false} className="mb-5 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold underline underline-offset-4 lg:hidden">
        ← Back to roles
      </Link>
      <div className="flex items-start justify-between gap-3">
        <p className="kicker">{job.company_name} / position brief</p>
        <FitBadge score={job.fit_score} />
      </div>
      <h2 id="job-detail-title" className="display mt-5 text-[34px] sm:text-[42px]">
        {job.title}
      </h2>
      <p className="mt-3 text-sm text-[var(--muted)]">
        {job.company_name} · {where(p)} · {LEVEL[p.level] ?? p.level}
        {posted ? ` · posted ${posted}` : ""}
      </p>
      <p className="mt-6">
        {salary ? (
          <>
            <span className="display text-[32px]">{salary.replace(/–\$/, "–")}</span> <span className="kicker">/ year</span>
          </>
        ) : (
          <span className="kicker">Pay not listed by the employer</span>
        )}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {app && st && (
          <Link href={`/applications?tab=all&app=${app.id}`} className="inline-flex min-h-[44px] items-center gap-2 bg-[var(--accent)] px-5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
            Open application ↗
          </Link>
        )}
        {/* Always mounted in the same spot (keyed by job), so its confirmation survives the refresh that follows a save. */}
        <PrepareDialog
          key={job.id}
          showTrigger={!app}
          jobId={job.id}
          title={job.title}
          company={job.company_name}
          place={where(p)}
          canSubmit={canSubmit}
          verified={p.verification_status === "verified"}
          ats={ATS[p.ats] ?? "employer’s"}
          resumes={resumes}
        />
        {savedOn && (
          <form action={toggleSavedJob.bind(null, job.id, !saved)}>
            <button className="inline-flex min-h-[44px] items-center gap-2 border border-[var(--border-strong)] bg-[var(--card)] px-4 text-sm font-semibold hover:border-[var(--foreground)]" aria-pressed={saved}>
              {saved ? "♥ Saved" : "+ Save role"}
            </button>
          </form>
        )}
      </div>
      {app && st && (
        <p className="mt-3 text-sm">
          Status: <Badge variant={st.tone}>{st.label}</Badge>
        </p>
      )}

      <div className="mt-8 border-t border-[var(--border)] pt-6">
        <h3 className="kicker !text-[var(--foreground)]">Why it’s on your list</h3>
        {reasons.length ? (
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="text-[var(--orange)]" aria-hidden>
                  —
                </span>
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">{/added by you/i.test(job.fit_reasons?.[0] ?? "") ? "You added this one from search." : "No detailed reasons were recorded for this match."}</p>
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">The label describes overlap with your resume, roles, level and location. It does not predict hiring decisions.</p>
      </div>

      {(good.length > 0 || bad.length > 0) && (
        <div className="mt-8 border-t border-[var(--border)] pt-6">
          <h3 className="kicker !text-[var(--foreground)]">Employer check</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {good.slice(0, 4).map((s, i) => (
              <li key={`g${i}`} className="flex gap-2 text-[var(--muted)]">
                <span className="text-emerald-400" aria-hidden>
                  ✓
                </span>
                {s.message}
              </li>
            ))}
            {bad.map((s, i) => (
              <li key={`b${i}`} className="flex gap-2 text-red-400">
                <span aria-hidden>!</span>
                {s.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 border-t border-[var(--border)] pt-6">
        <h3 className="kicker !text-[var(--foreground)]">Source</h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {ATS[p.ats] ?? p.ats ?? "Job board"} · {canSubmit ? "the agent can submit here" : "you submit this one yourself"}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <a href={p.apply_url || job.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-sm font-semibold underline underline-offset-4">
            Read the full posting ↗
          </a>
          {!app && (
            <form action={dismissJob.bind(null, job.id)}>
              <button className="min-h-[44px] text-sm text-[var(--muted)] underline-offset-4 hover:underline">Not for me — hide it</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
