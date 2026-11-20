import Link from "next/link";
import { unstable_cache } from "next/cache";
import { industrySectors, liveSearch, relevance, resolveLiveHit, type LiveHit } from "@/lib/v2/discovery/live-search";
import { WORKDAY_BOARDS, workdayDescription } from "@/lib/v2/discovery/workday";
import { usajobsEnabled } from "@/lib/v2/discovery/sources";
import { requireUser } from "@/lib/v2/session";
import { Badge, CompanyMark, Emphasis, FitBadge, buttonCls } from "@/components/ui";
import { PendingButton } from "./pending-button";
import { ago } from "@/lib/v2/priority";
import { agentCanSubmit } from "@/lib/v2/verify";
import { jobBrief } from "@/lib/v2/job-brief";
import { parseSalary } from "@/lib/v2/discovery/filters";
import { addSearchedJob } from "../actions";
import { applySearchResults } from "../search-actions";
import { PickBar } from "./pick-bar";

const PICK_FORM = "search-pick";

/**
 * "Search everywhere": one list of every job that matches the words — the jobs the agent has already
 * collected (for anyone, in any field) and live results from job sites and 60+ employers' career sites.
 * Pick one to read a brief (summary, requirements, nice-to-haves, key facts and how you match), then
 * apply now, queue it for the agent, or keep it in your roles.
 */

type Result = {
  key: string; // "db:<posting id>" or a live key ("remotive:123")
  title: string;
  company: string;
  location: string;
  is_remote: boolean;
  url: string;
  posted_at: string | null;
  posted_label?: string;
  salary_min: number | null;
  salary_max: number | null;
  source: string;
  verified: boolean | null; // null: not checked yet (live)
  agentCan: boolean;
  level: string | null;
  description: string | null;
  mineId?: string;
  appStatus?: string;
};

const SRC: Record<string, string> = { remotive: "Remotive", jobicy: "Jobicy", himalayas: "Himalayas", usajobs: "USAJOBS", workday: "Employer site", db: "Found by the agent" };
const pay = (a: number | null, b: number | null) => (b ? `$${Math.round((a ?? b) / 1000)}k${a && a !== b ? `–$${Math.round(b / 1000)}k` : ""}` : null);
/**
 * The same words searched again within 10 minutes (clicking through results re-renders the page) reuse
 * the first answer instead of asking 60+ job sites again — which is also what made them throttle us.
 * Only a result that actually found something is kept.
 */
const cachedLiveSearch = (term: string) =>
  unstable_cache(
    async () => {
      const r = await liveSearch(term, { timeoutMs: 8000 });
      if (!r.hits.length) throw Object.assign(new Error("no live results"), { r });
      return r;
    },
    ["live-search-v2", term],
    { revalidate: 600 }
  )().catch((e: { r?: Awaited<ReturnType<typeof liveSearch>> }) => e.r ?? { hits: [] as LiveHit[], failed: ["job sites"] });

const LEVEL: Record<string, string> = { internship: "Internship", new_grad: "New grad", entry: "Entry level", mid: "Mid level", senior: "Senior" };

export async function SearchEverywhere({
  term,
  pick,
  base,
  sinceIso,
  remoteOnly,
  minpay,
  loc,
  agentOnly = false,
}: {
  term: string;
  pick: string;
  /** /jobs?scope=web&q=… with the current filters, without `pick`. */
  base: string;
  sinceIso: string;
  remoteOnly: boolean;
  minpay: number;
  loc: string;
  /** Only jobs on sites the agent can apply on. */
  agentOnly?: boolean;
}) {
  const { supabase, user } = await requireUser();
  const like = term.replace(/[,()%*]/g, " ").trim();

  // Jobs already collected (any user's search, any field) + live job sites, in parallel.
  let dbq = supabase
    .from("job_postings")
    .select("id,title,company_name,locations,is_remote,salary_min,salary_max,posted_at,level,ats,url,apply_url,verification_status,description")
    .eq("active", true)
    .neq("verification_status", "rejected")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(200);
  const words = like.split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  // A word can be in the title, the company or the description; an industry word ("oil", "bank",
  // "hospital") also matches every job at the employers in that industry.
  const sectors = industrySectors(like);
  const industryCompanies = new Set(WORKDAY_BOARDS.filter((b) => sectors.includes(b.sector)).map((b) => b.company.toLowerCase()));
  const inIndustry = WORKDAY_BOARDS.filter((b) => sectors.includes(b.sector)).map((b) => `"${b.company.replace(/"/g, "")}"`);
  const industryOr = inIndustry.length ? `,company_name.in.(${inIndustry.join(",")})` : "";
  for (const w of words) dbq = dbq.or(`title.ilike.%${w}%,company_name.ilike.%${w}%,description.ilike.%${w}%${industryOr}`);
  if (sinceIso) dbq = dbq.gte("posted_at", sinceIso);
  if (remoteOnly) dbq = dbq.eq("is_remote", true);
  if (minpay) dbq = dbq.gte("salary_max", minpay);
  const [dbRes, live] = await Promise.all([dbq, cachedLiveSearch(term.toLowerCase())]);

  type Db = { id: string; title: string; company_name: string; locations: string[]; is_remote: boolean; salary_min: number | null; salary_max: number | null; posted_at: string | null; level: string | null; ats: string | null; url: string; apply_url: string | null; verification_status: string; description: string | null };
  const fromDb: Result[] = ((dbRes.data ?? []) as Db[]).map((p) => ({
    key: `db:${p.id}`,
    title: p.title,
    company: p.company_name,
    location: p.is_remote ? "Remote" : p.locations.slice(0, 2).join("; ") || "Location not listed",
    is_remote: p.is_remote,
    url: p.apply_url || p.url,
    posted_at: p.posted_at,
    salary_min: p.salary_min,
    salary_max: p.salary_max,
    source: "db",
    verified: p.verification_status === "verified",
    agentCan: agentCanSubmit(p),
    level: p.level,
    description: p.description,
  }));
  const fromLive: Result[] = live.hits
    .filter((h) => (!sinceIso || !h.posted_at || h.posted_at >= sinceIso) && (!remoteOnly || h.is_remote) && (!minpay || (h.salary_max ?? 0) >= minpay))
    .map((h: LiveHit) => ({
      key: h.key,
      title: h.title,
      company: h.company,
      location: h.location,
      is_remote: h.is_remote,
      url: h.url,
      posted_at: h.posted_at,
      posted_label: h.posted_label,
      salary_min: h.salary_min ?? null,
      salary_max: h.salary_max ?? null,
      source: h.source,
      verified: null,
      // Before the employer check: can the agent submit on this site at all?
      agentCan: agentCanSubmit({ verification_status: "verified", apply_url: h.url, url: h.url, ats: h.source === "workday" ? "workday" : null }),
      level: h.level ?? null,
      description: h.description ?? null,
    }));

  // One list, no duplicates (same title at the same company), newest first.
  const seen = new Set<string>();
  const results = [...fromDb, ...fromLive]
    .filter((r) => !loc || r.location.toLowerCase().includes(loc.toLowerCase()))
    .filter((r) => !agentOnly || r.agentCan)
    .filter((r) => {
      const k = `${r.title.toLowerCase().replace(/\W+/g, " ").trim()}|${r.company.toLowerCase().replace(/\W+/g, "")}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    // Jobs with the words in the title first, then the rest (employer in that industry, word in the
    // description); newest first within each.
    .map((r) => {
      // Saved jobs: the database matched letters ("oil" inside "soil"), so check whole words here. An
      // employer in the industry searched for counts even when the word isn't in the job.
      const own = relevance({ title: r.title, company: r.company, source: r.source === "db" ? "remotive" : (r.source as LiveHit["source"]), description: r.description ?? undefined }, term);
      const industry = r.source === "db" && industryCompanies.has(r.company.toLowerCase()) ? 1 : 0;
      return { r, rank: r.source === "db" ? Math.max(own, industry) : Math.max(1, own) };
    })
    .filter((x) => x.rank > 0)
    .sort((a, b) => b.rank - a.rank || Date.parse(b.r.posted_at ?? "0") - Date.parse(a.r.posted_at ?? "0"))
    .map((x) => x.r)
    .slice(0, 120);

  // Which of these are already yours (in your roles / applied).
  const postingIds = results.filter((r) => r.key.startsWith("db:")).map((r) => r.key.slice(3));
  const liveKeys = results.filter((r) => !r.key.startsWith("db:")).map((r) => r.key);
  const [{ data: minePosting }, { data: mineLive }] = await Promise.all([
    postingIds.length ? supabase.from("jobs").select("id,posting_id").eq("user_id", user.id).in("posting_id", postingIds) : Promise.resolve({ data: [] as { id: string; posting_id: string }[] }),
    liveKeys.length ? supabase.from("jobs").select("id,idempotency_key").eq("user_id", user.id).in("idempotency_key", liveKeys) : Promise.resolve({ data: [] as { id: string; idempotency_key: string }[] }),
  ]);
  const jobByKey = new Map<string, string>();
  for (const j of minePosting ?? []) jobByKey.set(`db:${j.posting_id}`, j.id as string);
  for (const j of mineLive ?? []) jobByKey.set(j.idempotency_key as string, j.id as string);
  const jobIds = [...jobByKey.values()];
  const { data: apps } = jobIds.length ? await supabase.from("applications").select("job_id,status").eq("user_id", user.id).in("job_id", jobIds) : { data: [] };
  const appByJob = new Map((apps ?? []).map((a) => [a.job_id as string, a.status as string]));
  for (const r of results) {
    r.mineId = jobByKey.get(r.key);
    if (r.mineId) r.appStatus = appByJob.get(r.mineId);
  }

  const selected = results.find((r) => r.key === pick) ?? results[0] ?? null;
  const picked = Boolean(pick && selected?.key === pick);
  const sep = base.includes("?") ? "&" : "?";
  const hrefFor = (k: string) => `${base}${sep}pick=${encodeURIComponent(k)}`;

  return (
    <section className="mt-6" aria-labelledby="search-results">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[var(--foreground)] pb-3">
        <h2 id="search-results" className="display text-[30px]">
          Everywhere, for <Emphasis text={`*“${term}”*`} />
        </h2>
        <p className="kicker">
          {results.length} result{results.length === 1 ? "" : "s"} · {results.filter((r) => r.source === "db").length} collected by the agent, {results.filter((r) => r.source !== "db").length} live
        </p>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
        Every field, not only your matches: jobs the agent has already collected plus live results from Remotive, Jobicy, Himalayas{usajobsEnabled() ? ", USAJOBS" : ""} and 60+ employers’ career sites. An industry word (oil, bank, hospital, retail) also brings every opening at employers in that industry.
        {live.failed.length ? ` Not answering right now: ${live.failed.join(", ")}.` : ""}
      </p>

      {results.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Nothing found for “{term}”. Try fewer or broader words (“nurse” rather than “registered nurse night shift”).</p>
      ) : (
        <div className="mt-4 grid items-start lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className={`lg:border-r lg:border-[var(--border)] ${picked ? "hidden lg:block" : ""}`}>
          {/* Tick jobs, then apply to all of them with the agent in one go. */}
          <form id={PICK_FORM} action={applySearchResults}>
            <input type="hidden" name="term" value={term} />
            <input type="hidden" name="back" value={base} />
            <PickBar formId={PICK_FORM} total={results.filter((r) => !r.appStatus).length} />
          </form>
          <ul aria-label="Search results">
            {results.map((r) => {
              const isSel = selected?.key === r.key;
              const age = r.posted_label ?? ago(r.posted_at);
              return (
                <li key={r.key} className={`relative flex items-stretch border-b border-[var(--border)] ${isSel ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}>
                  {isSel && <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--orange)]" aria-hidden />}
                  <label className="flex w-12 shrink-0 cursor-pointer items-start justify-center pt-6" title={r.appStatus ? "Already applied or queued" : "Select to apply with the agent"}>
                    <input type="checkbox" name="pick" value={r.key} form={PICK_FORM} disabled={Boolean(r.appStatus)} className="h-5 w-5 accent-[var(--accent)] disabled:opacity-40" aria-label={`Select ${r.title} at ${r.company}`} />
                  </label>
                  <Link href={hrefFor(r.key)} scroll={false} aria-current={isSel ? "true" : undefined} className="flex min-w-0 flex-1 gap-4 py-4 pr-3 lg:pr-5">
                    <CompanyMark name={r.company} />
                    <span className="min-w-0 flex-1">
                      <span className="kicker block">
                        {r.company} · {SRC[r.source] ?? r.source}
                      </span>
                      <span className="mt-0.5 block text-[16px] font-semibold leading-snug">{r.title}</span>
                      <span className="mt-1 block text-sm text-[var(--muted)]">
                        {r.location} · {pay(r.salary_min, r.salary_max) ?? "Pay not listed"}
                        {age ? ` · ${age}` : ""}
                      </span>
                      {(r.appStatus || r.mineId || r.agentCan) && (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {r.appStatus ? <Badge variant="success">Applied / queued</Badge> : r.mineId ? <Badge>In your roles</Badge> : null}
                          {r.agentCan && !r.appStatus && <Badge variant="default">Agent can apply</Badge>}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          </div>
          {selected && <ResultBrief r={selected} term={term} back={hrefFor(selected.key)} listHref={base} picked={picked} />}
        </div>
      )}
    </section>
  );
}

async function ResultBrief({ r, term, back, listHref, picked }: { r: Result; term: string; back: string; listHref: string; picked: boolean }) {
  const { supabase, user } = await requireUser();
  // Employer career sites don't send the description with search results: fetch this one job.
  let description = r.description;
  // One small request for this job's page (not a search, which employer sites often refuse).
  if (!description && r.source === "workday") description = (await workdayDescription(r.url).catch(() => null)) ?? (await resolveLiveHit(r.key, term).catch(() => null))?.description ?? null;
  const brief = jobBrief(description);
  const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const { matchPosting, profileToMatch } = await import("@/lib/v2/match");
  const fit = matchPosting(profileToMatch(prof ?? {}), {
    title: r.title,
    company_name: r.company,
    level: r.level,
    locations: [r.location],
    is_remote: r.is_remote,
    salary_min: r.salary_min,
    salary_max: r.salary_max,
    description,
  });
  const parsed = r.salary_max == null && description ? parseSalary(description) : {};
  const salary = pay(r.salary_min ?? parsed.min ?? null, r.salary_max ?? parsed.max ?? null);
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const ids = r.key.startsWith("db:") ? hidden("posting_id", r.key.slice(3)) : (
    <>
      {hidden("live_key", r.key)}
      {hidden("term", term)}
    </>
  );
  const List = ({ title, items }: { title: string; items: string[] }) =>
    items.length ? (
      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <h3 className="kicker !text-[var(--foreground)]">{title}</h3>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
          {items.map((x, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-[var(--orange)]" aria-hidden>
                —
              </span>
              {x}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <section aria-labelledby="result-title" className={`bg-[var(--card-2)] px-1 py-6 sm:px-8 lg:sticky lg:top-[92px] lg:max-h-[calc(100vh-108px)] lg:overflow-y-auto lg:overscroll-contain lg:px-10 ${picked ? "" : "hidden lg:block"}`}>
      <Link href={listHref} scroll={false} className="mb-5 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold underline underline-offset-4 lg:hidden">
        ← Back to results
      </Link>
      <div className="flex items-start justify-between gap-3">
        <p className="kicker">
          {r.company} / {SRC[r.source] ?? r.source}
        </p>
        {fit.eligible ? <FitBadge score={fit.score} /> : <Badge variant="warning">Outside your preferences</Badge>}
      </div>
      <h2 id="result-title" className="display mt-4 text-[30px] sm:text-[36px]">
        {r.title}
      </h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {r.company} · {r.location}
        {r.level && LEVEL[r.level] ? ` · ${LEVEL[r.level]}` : ""}
        {r.posted_label ? ` · posted ${r.posted_label}` : ago(r.posted_at) ? ` · posted ${ago(r.posted_at)}` : ""}
      </p>
      <p className="mt-4">{salary ? <span className="display text-[28px]">{salary}</span> : <span className="kicker">Pay not listed</span>}</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {r.appStatus && r.mineId ? (
          <Link href={`/applications?tab=all`} className={buttonCls("primary")}>
            Already applied / queued — see Applications ↗
          </Link>
        ) : (
          <>
            <form action={addSearchedJob}>
              {ids}
              {hidden("back", back)}
              {hidden("then", "apply")}
              <PendingButton className={buttonCls("primary")} pending="Starting…">
                {r.agentCan ? "Apply now" : "Add — I’ll apply"}
              </PendingButton>
            </form>
            {r.agentCan && (
              <form action={addSearchedJob}>
                {ids}
                {hidden("back", back)}
                {hidden("then", "queue")}
                <PendingButton className={buttonCls("secondary")} pending="Queuing…">
                  Queue for the agent
                </PendingButton>
              </form>
            )}
            {!r.mineId && (
              <form action={addSearchedJob}>
                {ids}
                {hidden("back", back)}
                <PendingButton className={buttonCls("ghost")} pending="Saving…">
                  + Save to my roles
                </PendingButton>
              </form>
            )}
          </>
        )}
        <a href={r.url} target="_blank" rel="noopener noreferrer" className={buttonCls("ghost")}>
          Full posting ↗
        </a>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        {r.agentCan
          ? "“Apply now” queues it and starts a run. The employer check runs first; the agent only sends to employers that pass it."
          : "The agent can’t submit on this site, so this goes under Needs you with the link — apply there yourself."}
      </p>

      {brief.summary && (
        <div className="mt-7 border-t border-[var(--border)] pt-5">
          <h3 className="kicker !text-[var(--foreground)]">In short</h3>
          <p className="mt-2 text-sm leading-relaxed">{brief.summary}</p>
        </div>
      )}
      {brief.facts.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {brief.facts.map((f) => (
            <Badge key={f}>{f}</Badge>
          ))}
        </div>
      )}
      <List title="What they’re asking for" items={brief.requirements} />
      <List title="Nice to have" items={brief.niceToHave} />
      <List title="What you’d do" items={brief.responsibilities} />
      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <h3 className="kicker !text-[var(--foreground)]">How you match</h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {fit.reasons.slice(0, 6).map((x) => {
            // A reason against the job ("Title isn't one of your target roles") gets "!", not a tick.
            const good = fit.eligible && !/\b(isn.t|not|below|looks senior|excluded|doesn.t)\b/i.test(x);
            return (
              <li key={x} className="flex gap-2">
                <span className={good ? "text-emerald-400" : "text-amber-400"} aria-hidden>
                  {good ? "✓" : "!"}
                </span>
                {x}
              </li>
            );
          })}
          {!fit.reasons.length && <li className="text-[var(--muted)]">Not enough in the posting to compare with your profile.</li>}
        </ul>
      </div>
      {!description && <p className="mt-6 text-sm text-[var(--muted)]">This site didn’t send a description with the search results. Open the full posting to read it.</p>}
    </section>
  );
}
