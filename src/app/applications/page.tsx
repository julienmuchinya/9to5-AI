import Link from "next/link";
import { timeFmt } from "@/lib/tz";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { Badge, Button, Card, CompanyMark, Emphasis, EmptyState, Notice, PageHeader, StatStrip, buttonCls } from "@/components/ui";
import { DeskButton, Icon } from "@/components/sidebar";
import { RouteDrawer } from "@/components/drawer";
import { customStore, findSimilarAnswer, questionSimilarity, type CustomAnswers, type PendingQuestion } from "@/lib/v2/app-questions";
import { type AskedQuestion } from "./pending-questions";
import { ApplicationQuestions, type StuckApplication } from "./application-questions";
import { BulkBar } from "./bulk-bar";
import { AnswersEditor } from "./answers-editor";
import { STAGE_LABEL, gmailLink, roleFamily } from "@/lib/v2/tracking";
import { ago } from "@/lib/v2/priority";
import { dispatchConfigured, nextScheduledRun } from "@/lib/v2/dispatch";
import { RunNowButton } from "@/components/run-now";
import { AiStatus } from "@/components/ai-status";
import { StageTrack } from "@/components/stage-track";
import { aiStatus } from "@/lib/v2/ai-status";
import { RevealPassword } from "../accounts/reveal";
import { markApplied, removeTimelineEvent, retryApplication, setApplicationStatus } from "../actions";
import { PROGRESSED, SENT, countPipeline, isSent, statusRows } from "@/lib/v2/pipeline";
import { NEEDS_LABEL, needsKind, type NeedsKind } from "@/lib/v2/needs";
import { funnel, pct, stateLabel } from "@/lib/v2/overview";
import { APP_FILTER } from "@/lib/v2/app-filter";

export const dynamic = "force-dynamic";

const PAGE = 24;
/** Which statuses each filter tab shows (shared with the bulk "select all" action). */
const FILTER = APP_FILTER;

const hostOf = (u: string | null | undefined) => {
  try {
    return new URL(u ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
};
/** Old rows stored answers under internal field ids ("f3"); hide those and file markers. */
const readable = (answers: Record<string, string> | null) =>
  Object.entries(answers ?? {}).filter(([q, v]) => v && v !== "__RESUME__" && !/^f\d+(_\d+)?$/.test(q));

type Row = {
  id: string;
  status: string;
  error: string | null;
  apply_url: string | null;
  submitted_at: string | null;
  created_at: string;
  status_updated_at: string | null;
  requested_by: string;
  resume_focus: string | null;
  attempts: number | null;
  answers?: Record<string, string> | null;
  pending_questions?: PendingQuestion[] | null;
  jobs: { title: string; company_name: string; url: string; job_postings: { posted_at: string | null } | null } | null;
};
type Event = { id?: string; application_id: string; kind: string; source: string; detail: string | null; created_at: string; message_id?: string | null };

const ROW_SELECT = "id,status,error,apply_url,submitted_at,created_at,status_updated_at,requested_by,resume_focus,attempts,jobs(title,company_name,url,job_postings(posted_at))";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; msg?: string; sort?: string; page?: string; why?: string; app?: string }> }) {
  const { supabase, user } = await requireUser();
  const t = await timeFmt();
  const sp = await searchParams;
  const sort = sp.sort ?? "newest";
  const page = Math.max(1, Number(sp.page) || 1);

  // Counts come from every application (3 small columns), so these numbers match the Overview exactly.
  const [all, { data: lastRun }, { data: prof }, { data: needRows }, { data: logins }, ai] = await Promise.all([
    statusRows(supabase, user.id),
    supabase.from("agent_runs").select("started_at,ended_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("profiles").select("custom_answers,inbox_email,inbox_host").eq("id", user.id).maybeSingle(),
    supabase.from("applications").select("id,error,pending_questions,answers,updated_at,jobs(company_name,title)").eq("user_id", user.id).eq("status", "needs_user").order("updated_at", { ascending: false }).limit(500),
    supabase.from("application_accounts").select("id,portal_host,email_used,account_created").eq("user_id", user.id),
    aiStatus(serviceClient()),
  ]);
  const c = countPipeline(all);
  const f = funnel(all);
  const tab = sp.tab && sp.tab in FILTER ? sp.tab : c.needs > 0 ? "needs" : "all";
  const why = (sp.why ?? "") as NeedsKind | "";

  // Questions the agent couldn't answer, merged across applications, minus any answered since.
  const mine = customStore(prof?.custom_answers as CustomAnswers | null);
  const asked = new Map<string, AskedQuestion>();
  const kinds = new Map<string, NeedsKind>();
  const kindCount: Partial<Record<NeedsKind, number>> = {};
  const stuck: StuckApplication[] = [];
  for (const r of (needRows ?? []) as unknown as { id: string; error: string | null; pending_questions: PendingQuestion[] | null; answers: Record<string, string> | null; jobs: { company_name: string; title: string } | null }[]) {
    const open = (r.pending_questions ?? []).filter((q) => !mine[q.key] && !findSimilarAnswer(q.label, q.options ?? [], mine));
    // The whole form as the agent filled it, so each open question is seen with everything answered before it.
    if (open.length)
      stuck.push({
        id: r.id,
        company: r.jobs?.company_name ?? "A company",
        title: r.jobs?.title ?? "",
        answered: readable(r.answers ?? null)
          .filter(([q2]) => !open.some((o) => o.label === q2))
          .map(([q2, a2]) => [q2, String(a2)] as [string, string]),
        open,
        alsoAsking: 0,
      });
    const k = needsKind(r.error, open.length);
    kinds.set(r.id, k);
    kindCount[k] = (kindCount[k] ?? 0) + 1;
    for (const q of open) {
      const company = r.jobs?.company_name ?? "a company";
      const same = asked.get(q.key) ?? [...asked.values()].find((x) => questionSimilarity(x.label, q.label) >= 0.75);
      const ctx = q.context?.length ? [{ company, context: q.context }] : [];
      if (same) {
        if (!same.companies.includes(company)) same.companies.push(company);
        for (const c of ctx) if (!same.contexts.some((x) => x.company === c.company)) same.contexts.push(c);
      } else asked.set(q.key, { ...q, options: q.options ?? [], companies: [company], contexts: ctx, appId: r.id });
    }
  }
  const questions = [...asked.values()].sort((a, b) => b.companies.length - a.companies.length);
  // How many OTHER waiting applications the same answers unblock.
  for (const a of stuck) {
    const others = new Set<string>();
    for (const q of a.open) {
      const same = asked.get(q.key) ?? [...asked.values()].find((x) => questionSimilarity(x.label, q.label) >= 0.75);
      for (const c2 of same?.companies ?? []) if (c2 !== a.company) others.add(c2);
    }
    a.alsoAsking = others.size;
  }

  // Only the rows on screen are loaded.
  const statuses = FILTER[tab];
  const order = sort === "oldest" ? { col: "created_at", asc: true } : sort === "status" ? { col: "status", asc: true } : { col: "created_at", asc: false };
  let q = supabase.from("applications").select(ROW_SELECT, { count: "exact" }).eq("user_id", user.id);
  if (tab === "sent") q = q.or(`submitted_at.not.is.null,status.in.(${SENT.join(",")})`);
  else if (statuses) q = q.in("status", statuses);
  if (tab === "needs" && why) {
    const ids = [...kinds.entries()].filter(([, k]) => k === why).map(([id]) => id);
    q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  q = q.order(order.col, { ascending: order.asc });
  if (order.col !== "created_at") q = q.order("created_at", { ascending: false });
  const { data, count: filteredCount, error: listError } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as unknown as Row[];
  if (sort === "company") rows.sort((a, b) => (a.jobs?.company_name ?? "").localeCompare(b.jobs?.company_name ?? ""));
  if (sort === "posted") rows.sort((a, b) => Date.parse(b.jobs?.job_postings?.posted_at ?? "0") - Date.parse(a.jobs?.job_postings?.posted_at ?? "0"));
  const pages = Math.max(1, Math.ceil((filteredCount ?? 0) / PAGE));

  // The open application (detail drawer), with its answers and full timeline.
  const { data: openRow } = sp.app
    ? await supabase.from("applications").select(`${ROW_SELECT},answers,pending_questions`).eq("user_id", user.id).eq("id", sp.app).maybeSingle()
    : { data: null };
  const open = openRow as unknown as Row | null;
  const { data: openEvents } = open
    ? await supabase.from("application_events").select("id,application_id,kind,source,detail,created_at,message_id").eq("application_id", open.id).order("created_at", { ascending: false })
    : { data: [] as Event[] };

  // Latest event per visible row, for "last activity".
  const shownIds = rows.map((r) => r.id);
  const { data: evs } = shownIds.length
    ? await supabase.from("application_events").select("application_id,kind,source,detail,created_at").in("application_id", shownIds).order("created_at", { ascending: false }).limit(500)
    : { data: [] as Event[] };
  const latest = new Map<string, Event>();
  for (const e of (evs ?? []) as Event[]) if (!latest.has(e.application_id)) latest.set(e.application_id, e);
  const loginByHost = new Map((logins ?? []).map((l) => [l.portal_host as string, l]));

  // What's working, by job type (sent applications only).
  const { data: sentTitles } = c.sent >= 3 ? await supabase.from("applications").select("status,submitted_at,jobs(title)").eq("user_id", user.id).or(`submitted_at.not.is.null,status.in.(${SENT.join(",")})`).limit(2000) : { data: [] };
  const fam = new Map<string, { sent: number; good: number; rejected: number }>();
  for (const r of (sentTitles ?? []) as unknown as { status: string; submitted_at: string | null; jobs: { title: string } | null }[]) {
    if (!isSent(r) || !r.jobs?.title) continue;
    const k = roleFamily(r.jobs.title);
    const v = fam.get(k) ?? { sent: 0, good: 0, rejected: 0 };
    v.sent++;
    if ((PROGRESSED as readonly string[]).includes(r.status)) v.good++;
    if (r.status === "rejected") v.rejected++;
    fam.set(k, v);
  }
  const byFamily = [...fam.entries()].sort((a, b) => b[1].good / b[1].sent - a[1].good / a[1].sent || b[1].sent - a[1].sent).slice(0, 6);

  const next = nextScheduledRun();
  const running = lastRun?.status === "running";
  const link = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = { tab, sort, why: why || undefined, page, ...o };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "page" && Number(v) === 1) && !(k === "sort" && v === "newest")) p.set(k, String(v));
    return `/applications?${p.toString()}`;
  };
  const tabs: [string, string, number][] = [
    ["all", "All applications", c.total],
    ["needs", "Needs attention", c.needs],
    ["interview", "Interviews", c.interviews],
    ["drafts", "Drafts", c.drafts],
    ["queued", "Queued", c.queued],
    ["sent", "Sent", c.sent],
    ["review", "In review", c.inReview],
    ["screening", "Screening", c.screening],
    ["rejected", "Rejected", c.rejected],
    ["failed", "Closed / ignored", c.failed + c.closed + c.ignored],
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Applications / every step counts"
        aside="The running record"
        title="Keep the *thread.*"
        action={
          <Link href="/jobs" className={buttonCls("primary")}>
            Find more roles ↗
          </Link>
        }
      />

      <StatStrip
        items={[
          { value: c.total, label: "Tracked applications", href: link({ tab: "all", why: undefined, page: 1, app: undefined }) },
          { value: c.needs, label: "Need attention", href: link({ tab: "needs", why: undefined, page: 1, app: undefined }), tone: c.needs ? "warning" : undefined },
          { value: c.screening + c.interviews, label: "In conversation", href: link({ tab: "interview", why: undefined, page: 1, app: undefined }) },
          { value: f.confirmed, label: "Confirmed submissions", href: link({ tab: "sent", why: undefined, page: 1, app: undefined }) },
        ]}
      />
      <div className="mb-8 mt-3 flex flex-wrap items-center justify-between gap-3">
        <AiStatus data={ai} compact when={t.dateTime} />
        {dispatchConfigured() && <RunNowButton running={running} />}
      </div>

      {sp.msg && (
        <div className="mb-4" role="status">
          <Notice tone={/couldn't/i.test(sp.msg) ? "danger" : "success"}>{sp.msg}</Notice>
        </div>
      )}

      {tab !== "needs" && questions.length > 0 && (
        <div className="mb-5">
          <Notice tone="warning">
            {questions.length} question{questions.length === 1 ? " is" : "s are"} holding up applications.{" "}
            <Link href="/applications?tab=needs#questions" className="font-medium underline">
              Answer {questions.length === 1 ? "it" : "them"} once →
            </Link>
          </Notice>
        </div>
      )}
      {tab === "needs" && <ApplicationQuestions apps={stuck.slice(0, 40)} />}

      {c.queued > 0 && tab === "queued" && (
        <Card className="mb-5 border-[var(--accent)]/30 bg-gradient-to-r from-[var(--accent-soft)] to-transparent p-4">
          <p className="text-sm">
            {running ? `The agent is applying right now (started ${ago(lastRun?.started_at)}).` : `${c.queued} waiting — next scheduled run ~${t.time(next, true)} (GitHub may start it late).`}{" "}
            <span className="text-[var(--muted)]">
              Freshest postings go first, max 10 per company per day.{lastRun && !running ? ` Last run ${ago(lastRun.started_at)} (${lastRun.status}).` : ""}
            </span>
          </p>
        </Card>
      )}

      <div>
        {/* Filter tabs */}
        <div className="flex items-center gap-3 pb-4">
          <nav aria-label="Filter applications" className="no-scrollbar -mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1">
            {tabs
              .filter(([k, , n]) => n > 0 || ["all", "needs", "interview"].includes(k) || tab === k)
              .map(([k, label, n]) => (
                <Link
                  key={k}
                  href={link({ tab: k, why: undefined, page: 1, app: undefined })}
                  scroll={false}
                  aria-current={tab === k ? "page" : undefined}
                  className={`inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-sm border px-3.5 text-sm transition ${
                    tab === k ? "border-[var(--accent)] bg-[var(--accent)] font-semibold text-white" : "border-[var(--border-strong)] bg-[var(--card)] hover:border-[var(--foreground)]"
                  }`}
                >
                  {label}
                  <span className={`font-mono text-[11px] ${tab === k ? "text-white/75" : k === "needs" && n > 0 ? "text-[var(--orange-text)]" : "text-[var(--muted)]"}`}>{n}</span>
                </Link>
              ))}
          </nav>
          <span className="kicker hidden shrink-0 sm:inline">{String(filteredCount ?? 0).padStart(2, "0")} records shown</span>
        </div>
        <div className="border-t-2 border-[var(--foreground)]">

        {tab === "needs" && Object.keys(kindCount).length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-4 py-3">
            <Link href={link({ why: undefined, page: 1 })} scroll={false} className={`rounded-full px-3 py-1.5 text-xs ring-1 ring-inset ${!why ? "bg-[var(--accent-soft)] text-[var(--accent-text)] ring-[var(--accent)]/30" : "text-[var(--muted)] ring-[var(--border)] hover:text-[var(--foreground)]"}`}>
              All reasons ({c.needs})
            </Link>
            {(Object.keys(NEEDS_LABEL) as NeedsKind[])
              .filter((k) => kindCount[k])
              .map((k) => (
                <Link
                  key={k}
                  href={link({ why: k, page: 1 })}
                  scroll={false}
                  title={NEEDS_LABEL[k].hint}
                  className={`rounded-full px-3 py-1.5 text-xs ring-1 ring-inset ${why === k ? "bg-amber-400/10 text-amber-300 ring-amber-400/40" : "text-[var(--muted)] ring-[var(--border)] hover:text-[var(--foreground)]"}`}
                >
                  {NEEDS_LABEL[k].label} ({kindCount[k]})
                </Link>
              ))}
            {why && NEEDS_LABEL[why]?.hint && <p className="w-full pt-1 text-xs text-[var(--muted)]">{NEEDS_LABEL[why].hint}</p>}
          </div>
        )}

        {rows.length > 0 && (
          <div className="border-b border-[var(--border)] px-4 py-3">
            <BulkBar
              back={link({ page, app: undefined })}
              sort={sort}
              tab={tab}
              why={why}
              total={filteredCount ?? rows.length}
              shown={rows.length}
              viewLabel={tabs.find(([k]) => k === tab)?.[1] ?? "this view"}
            />
          </div>
        )}

        {listError ? (
          <div className="p-6">
            <EmptyState icon="!" message="Couldn’t load your applications. Refresh the page to try again." />
          </div>
        ) : c.total === 0 ? (
          <div className="p-6">
            <EmptyState message="No applications yet. Apply to a matched job, ask in Chat, or turn on auto-submit." action={<Button href="/jobs">Find jobs</Button>} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState message="Nothing here right now." />
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Applications — select a row to see its details</caption>
            <thead className="hidden border-b border-[var(--border)] text-left font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-[var(--muted)] xl:table-header-group">
              <tr>
                <th scope="col" className="w-10 py-3 pl-4">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col" className="py-3 pr-3 font-normal">Role &amp; company</th>
                <th scope="col" className="py-3 pr-3 font-normal">Current stage</th>
                <th scope="col" className="py-3 pr-3 font-normal">Last change</th>
                <th scope="col" className="py-3 pr-3 font-normal">Next step</th>
                <th scope="col" className="w-12 py-3 pr-4">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = stateLabel(r.status);
                const ev = latest.get(r.id);
                const lastAt = ev?.created_at ?? r.status_updated_at ?? r.submitted_at ?? r.created_at;
                const kind = r.status === "needs_user" ? kinds.get(r.id) : undefined;
                const nextStep = kind ? NEEDS_LABEL[kind].label : r.status === "queued" && (r.attempts ?? 0) > 0 ? `Retry ${(r.attempts ?? 0) + 1} of 3 on next run` : st.next;
                const href = link({ app: r.id });
                return (
                  <tr key={r.id} className={`grid grid-cols-[auto_1fr_auto] gap-x-3 border-b border-[var(--border)] px-1 py-4 hover:bg-[var(--hover)] xl:table-row xl:px-0 xl:py-0 ${sp.app === r.id ? "bg-[var(--accent-soft)]" : ""}`}>
                    <td className="row-span-3 pt-0.5 xl:py-5 xl:pl-3">
                      <input
                        type="checkbox"
                        form="bulk"
                        name="ids"
                        value={r.id}
                        aria-label={`Select ${r.jobs?.title ?? "application"} at ${r.jobs?.company_name ?? ""}`}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="min-w-0 xl:py-5 xl:pr-3">
                      <Link href={href} scroll={false} className="block min-w-0 hover:text-[var(--accent-text)]">
                        <span className="block truncate font-semibold" title={r.jobs?.title}>
                          {r.jobs?.title ?? "Job"}
                        </span>
                        <span className="block truncate text-[13px] text-[var(--muted)]">{r.jobs?.company_name}</span>
                      </Link>
                    </td>
                    <td className="col-start-3 row-start-1 xl:py-5 xl:pr-3">
                      <Badge variant={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="col-start-2 text-xs text-[var(--muted)] xl:py-5 xl:pr-3 xl:text-sm">
                      <span className="xl:hidden">Last activity: </span>
                      {ago(lastAt) ?? t.date(lastAt)}
                    </td>
                    <td className={`col-start-2 text-xs xl:py-5 xl:pr-3 xl:text-sm ${kind ? "font-medium text-amber-300" : "text-[var(--muted)] xl:text-[var(--foreground)]"}`}>{nextStep}</td>
                    <td className="hidden xl:table-cell xl:py-5 xl:pr-4">
                      <Link href={href} scroll={false} className="grid h-10 w-10 place-items-center text-lg hover:bg-[var(--hover)]" aria-label={`Open ${r.jobs?.title ?? "application"}`}>
                        ↗
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        </div>
      </div>

      {pages > 1 && (
        <nav className="mt-5 flex items-center justify-center gap-2 text-sm" aria-label="Pages">
          {page > 1 && (
            <Link href={link({ page: page - 1, app: undefined })} className={buttonCls("secondary", "sm")}>
              ← Newer
            </Link>
          )}
          <span className="text-[var(--muted)]">
            Page {page} of {pages} · {filteredCount} applications
          </span>
          {page < pages && (
            <Link href={link({ page: page + 1, app: undefined })} className={buttonCls("secondary", "sm")}>
              Older →
            </Link>
          )}
        </nav>
      )}

      {/* A clear record */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 bg-[var(--accent-soft)] px-6 py-6">
        <div>
          <p className="display text-[24px]">A clear record, without the guesswork.</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Every role keeps its own history, next step and source. Nothing is marked submitted without evidence.</p>
        </div>
        <DeskButton open={{ drawer: "help" }} className={buttonCls("secondary")}>
          How tracking works ↗
        </DeskButton>
      </div>

      {/* Funnel */}
      <section className="mt-12" aria-labelledby="funnel">
        <h2 id="funnel" className="display text-[30px]">
          From first look to <Emphasis text="*conversation.*" />
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Counts only what’s recorded. Employers that never reply, or replies outside your connected inbox, aren’t counted.</p>
        <ol className="mt-5 grid grid-cols-2 border-t-2 border-[var(--foreground)] sm:grid-cols-5">
          {(
            [
              ["Tracked", f.tracked, null],
              ["Sent", f.sent, pct(f.sent, f.tracked)],
              ["Confirmed received", f.confirmed, pct(f.confirmed, f.sent)],
              ["Employer responded", f.responses, pct(f.responses, f.sent)],
              ["Interviews", f.interviews, pct(f.interviews, f.sent)],
            ] as [string, number, number | null][]
          ).map(([label, n, rate], i) => (
            <li key={label} className={`border-b border-[var(--border)] py-5 pr-4 ${i ? "sm:border-l sm:pl-5" : ""}`}>
              <p className="kicker">{String(i + 1).padStart(2, "0")} / {label}</p>
              <p className="display mt-2 text-[40px] tabular-nums">{n}</p>
              {rate != null && <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{rate}%{label === "Sent" ? " of tracked" : " of sent"}</p>}
            </li>
          ))}
        </ol>
        {byFamily.length > 0 && (
          <details className="mt-5 border-t border-[var(--border)] pt-4">
            <summary className="cursor-pointer text-sm font-semibold">
              What’s working: response rate by job type{" "}
              <Link href="/resumes" className="ml-2 text-xs font-normal text-[var(--accent-text)] hover:underline">
                by resume →
              </Link>
            </summary>
            <div className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {byFamily.map(([k, v]) => (
                <div key={k} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{k}</span>
                    <span className="shrink-0 text-[var(--muted)]">
                      {v.good}/{v.sent} moved forward · {v.rejected} rejected
                    </span>
                  </div>
                  <div className="mt-1 h-1 bg-[var(--hover)]">
                    <div className="h-1 bg-[var(--accent)]" style={{ width: `${Math.round((100 * v.good) / v.sent)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {open && (
        <RouteDrawer closeHref={link({ app: undefined })} label={`${open.jobs?.title ?? "Application"} at ${open.jobs?.company_name ?? ""}`}>
          <ApplicationDetail
            r={open}
            events={(openEvents ?? []) as Event[]}
            kind={open.status === "needs_user" ? needsKind(open.error, (open.pending_questions ?? []).filter((x) => !findSimilarAnswer(x.label, x.options ?? [], mine)).length) : undefined}
            waiting={(open.pending_questions ?? []).filter((x) => !findSimilarAnswer(x.label, x.options ?? [], mine))}
            login={loginByHost.get(hostOf(open.apply_url ?? open.jobs?.url))}
            closeHref={link({ app: undefined })}
            t={t}
            inbox={/gmail|google/i.test(`${prof?.inbox_host ?? ""} ${prof?.inbox_email ?? ""}`) ? (prof?.inbox_email ?? "") : null}
          />
        </RouteDrawer>
      )}
    </div>
  );
}

function ApplicationDetail({
  r,
  events,
  kind,
  waiting,
  login,
  closeHref,
  t,
  inbox,
}: {
  r: Row;
  events: Event[];
  kind?: NeedsKind;
  waiting: PendingQuestion[];
  login?: { id: string; portal_host: string; email_used: string; account_created: boolean };
  closeHref: string;
  t: Awaited<ReturnType<typeof timeFmt>>;
  /** The connected Gmail address (links open the email there); null for other inboxes. */
  inbox: string | null;
}) {
  const st = stateLabel(r.status);
  const answers = readable(r.answers ?? null);
  const posted = ago(r.jobs?.job_postings?.posted_at);
  const url = r.apply_url ?? r.jobs?.url;
  // The email that moved it to this stage (newest first), so an interview can be scheduled in one click.
  const stageEmail = ["screening", "interview", "offer", "under_review", "rejected"].includes(r.status)
    ? events.find((e) => e.source === "email" && e.kind === r.status) ?? events.find((e) => e.source === "email")
    : undefined;
  const mailHref = (e: Event) => (inbox != null && e.source === "email" ? gmailLink(inbox, e.message_id, e.detail) : null);
  const stageHref = stageEmail ? mailHref(stageEmail) : null;
  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 pb-5 pt-7 sm:px-10">
        <div className="min-w-0">
          <p className="kicker !text-[var(--orange-text)]">Application record / {r.id.slice(0, 4).toUpperCase()}</p>
          <h2 className="display mt-2 text-[32px] sm:text-[38px]" title={r.jobs?.title}>
            {r.jobs?.title ?? "Application"}
          </h2>
        </div>
        <Link href={closeHref} scroll={false} data-autofocus className="grid h-11 w-11 shrink-0 place-items-center rounded-sm border border-[var(--border-strong)] text-lg hover:border-[var(--foreground)]" aria-label="Close details">
          ×
        </Link>
      </div>

      <div className="space-y-7 px-6 py-6 sm:px-10">
        <div className="flex items-center gap-4 border-b border-[var(--border)] pb-5">
          <CompanyMark name={r.jobs?.company_name ?? "?"} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{r.jobs?.company_name}</p>
            <p className="text-xs text-[var(--muted)]">{posted ? `Posted ${posted}` : "Posting date unknown"}</p>
          </div>
          <Badge variant={st.tone}>{st.label}</Badge>
        </div>

        <div>
          <p className="kicker rule-label">Next recommended action</p>
          <p className="display mt-2 text-[26px]">{kind ? NEEDS_LABEL[kind].label : st.next || "Nothing to do"}</p>
          {kind && NEEDS_LABEL[kind].hint && <p className="mt-2 text-sm text-[var(--muted)]">{NEEDS_LABEL[kind].hint}</p>}
          {r.status === "submitted" && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              The agent saw the site’s success page, but the employer hasn’t confirmed by email yet. It changes to “Confirmed received” when the confirmation reaches your connected inbox.
            </p>
          )}
          {r.status === "draft" && <p className="mt-2 text-sm text-[var(--muted)]">This draft hasn’t gone anywhere. Queue it when you’re ready and the agent applies on its next run.</p>}
          {stageEmail && (
            <div className="mt-4 border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
              <p className="font-semibold">{r.status === "interview" || r.status === "screening" ? "The email with your next step" : "The email behind this status"}</p>
              <p className="mt-0.5 text-[var(--muted)]">“{stageEmail.detail ?? "Email"}” · {t.date(stageEmail.created_at)}</p>
              {stageHref ? (
                <a href={stageHref} target="_blank" rel="noopener noreferrer" className={`${buttonCls("primary", "sm")} mt-2 min-h-[40px]`}>
                  {r.status === "interview" || r.status === "screening" ? "Open the email to schedule" : "Open the email"} <Icon name="external" className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="mt-1 text-xs text-[var(--muted)]">Search your inbox for that subject to open it.</p>
              )}
            </div>
          )}
          <StageTrack status={r.status} history={events.map((e) => e.kind)} />
        </div>

        <dl className="grid grid-cols-2 border-t border-[var(--border)] text-sm">
          {(
            [
              [r.submitted_at ? "Applied" : "Added", r.submitted_at ? t.dateTime(r.submitted_at) : t.date(r.created_at)],
              ["Resume used", r.resume_focus ?? (r.submitted_at ? "Main resume" : "Chosen when it applies")],
              ["Requested by", r.requested_by === "user" ? "You" : "Agent (auto-submit)"],
              ["Attempts", String(r.attempts ?? 0)],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="border-b border-[var(--border)] py-3 pr-3">
              <dt className="kicker">{k}</dt>
              <dd className="mt-1 truncate">{v}</dd>
            </div>
          ))}
        </dl>

        {r.error && ["needs_user", "queued", "failed"].includes(r.status) && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">What happened</h3>
            <p className={`text-sm ${r.status === "queued" ? "text-[var(--muted)]" : "text-amber-300"}`}>{r.error}</p>
          </div>
        )}

        {waiting.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">Waiting on your answer</h3>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {waiting.slice(0, 6).map((x) => (
                <li key={x.key}>
                  {x.context?.length ? (
                    <span className="block text-xs text-[var(--muted)]">
                      After “{x.context[x.context.length - 1].label}”{x.context[x.context.length - 1].answer ? ` (answered “${x.context[x.context.length - 1].answer}”)` : ""}:
                    </span>
                  ) : null}
                  {x.label}
                </li>
              ))}
            </ul>
            <Link href="/applications?tab=needs#questions" className="mt-1.5 inline-block text-sm font-medium text-[var(--accent-text)] hover:underline">
              Answer once for every application →
            </Link>
          </div>
        )}

        {login && r.status === "needs_user" && (
          <div className="border border-[var(--border)] p-5 text-sm">
            <h3 className="mb-1 font-semibold">Portal login</h3>
            <p className="text-[var(--muted)]">
              {login.portal_host} {login.account_created ? "· account created" : "· create the account with:"}
            </p>
            <p className="mt-1 truncate">
              <code className="rounded bg-[var(--hover)] px-1">{login.email_used}</code>
            </p>
            <div className="mt-1">
              <RevealPassword id={login.id} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className={`${buttonCls(r.status === "needs_user" ? "primary" : "secondary")} min-h-[44px]`}>
              {r.status === "needs_user" ? "Open application" : "Posting"} <Icon name="external" className="h-3.5 w-3.5" />
            </a>
          )}
          {r.status === "needs_user" && (
            <form action={markApplied.bind(null, r.id)}>
              <button className={`${buttonCls("secondary")} min-h-[44px]`}>I applied myself</button>
            </form>
          )}
          {r.status === "draft" && (
            <form action={retryApplication.bind(null, r.id)}>
              <button className={buttonCls("primary")}>Queue it for the agent ↗</button>
            </form>
          )}
          {["needs_user", "failed", "ignored"].includes(r.status) && (
            <form action={retryApplication.bind(null, r.id)}>
              <button className={buttonCls("ghost")} title="Put it back in the queue">
                Retry
              </button>
            </form>
          )}
        </div>

        <details className="border border-[var(--border)] p-5 text-sm" open={answers.length > 0 && answers.length <= 12}>
          <summary className="cursor-pointer font-semibold">Answers ({answers.length})</summary>
          <p className="mb-2 mt-1 text-xs text-[var(--muted)]">
            What the agent filled in from your profile and resume. Edit or delete any of them, or add one. Tick “use on every application” to change what the agent answers from now on.
          </p>
          <AnswersEditor appId={r.id} answers={answers.slice(0, 80).map(([q2, a]) => [q2, String(a)])} company={r.jobs?.company_name ?? ""} />
        </details>

        <div>
          <h3 className="display text-[28px]">A record of progress.</h3>
          <ol className="mt-3 border-t border-[var(--foreground)] text-sm">
            {[
              ...events.map((e) => ({
                id: e.id,
                stage: e.kind,
                kind: STAGE_LABEL[e.kind] ?? e.kind,
                at: e.created_at,
                who: e.source === "email" ? "from your inbox" : e.source === "agent" ? "by the agent" : "by you",
                detail: e.detail,
                href: mailHref(e),
                email: e.source === "email",
              })),
              { id: undefined, stage: "", kind: "Added", at: r.created_at, who: "", detail: null, href: null, email: false },
            ].map((e, i) => (
              <li key={i} className="border-b border-[var(--border)] py-3.5">
                <p className="kicker">{String(i + 1).padStart(2, "0")} / event</p>
                <p className="mt-1">
                  {t.date(e.at).replace(/, \d{4}$/, "")} — {e.kind}
                  {e.who && <span className="text-[var(--muted)]"> · {e.who}</span>}
                </p>
                {e.detail && <p className="mt-0.5 text-xs text-[var(--muted)]">{e.detail}</p>}
                {(e.href || (e.id && e.email && e.stage !== "submitted")) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-4 text-xs">
                    {e.href && (
                      <a href={e.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[32px] items-center gap-1 font-semibold underline underline-offset-4">
                        Open email <Icon name="external" className="h-3 w-3" />
                      </a>
                    )}
                    {e.id && e.email && e.stage !== "submitted" && (
                      <form action={removeTimelineEvent.bind(null, r.id, e.id)}>
                        <button className="min-h-[32px] text-[var(--muted)] underline-offset-4 hover:underline" title="This email wasn't about this application, or didn't say this">
                          Not right — remove
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>

        {!["needs_user", "queued", "draft"].includes(r.status) && (
          <form action={setApplicationStatus.bind(null, r.id)} className="space-y-2 border border-[var(--border)] p-5">
            <h3 className="text-sm font-semibold">Record an update</h3>
            <p className="text-xs text-[var(--muted)]">E.g. a recruiter called. This only changes your record — nothing is sent to the employer.</p>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="status-select">
                Status
              </label>
              <select id="status-select" name="status" defaultValue={r.status} className="min-h-[40px] rounded-sm border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm">
                {["submitted", "received", "under_review", "screening", "interview", "offer", "rejected", "withdrawn"].map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="status-note">
                Note
              </label>
              <input id="status-note" name="note" placeholder="Note (optional)" className="min-h-[40px] min-w-0 flex-1 rounded-sm border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm" />
              <button className={`${buttonCls("secondary", "sm")} min-h-[40px]`}>Save</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
