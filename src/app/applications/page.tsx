import Link from "next/link";
import { timeFmt } from "@/lib/tz";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { Badge, Card, EmptyState, Notice, PageHeader, StatButton, buttonCls } from "@/components/ui";
import { customStore, findSimilarAnswer, questionSimilarity, type CustomAnswers, type PendingQuestion } from "@/lib/v2/app-questions";
import { PendingQuestions, type AskedQuestion } from "./pending-questions";
import { BulkBar } from "./bulk-bar";
import { STAGE_LABEL, roleFamily } from "@/lib/v2/tracking";
import { ago } from "@/lib/v2/priority";
import { dispatchConfigured, nextScheduledRun } from "@/lib/v2/dispatch";
import { RunNowButton } from "@/components/run-now";
import { AiStatus } from "@/components/ai-status";
import { StageTrack } from "@/components/stage-track";
import { aiStatus } from "@/lib/v2/ai-status";
import { RevealPassword } from "../accounts/reveal";
import { markApplied, retryApplication, setApplicationStatus } from "../actions";
import { PROGRESSED, SENT, countPipeline, isSent, statusRows } from "@/lib/v2/pipeline";
import { NEEDS_LABEL, needsKind, type NeedsKind } from "@/lib/v2/needs";

export const dynamic = "force-dynamic";

type Variant = "success" | "warning" | "danger" | "default" | "accent" | "info";
const VARIANT: Record<string, Variant> = {
  queued: "accent",
  submitted: "info",
  received: "info",
  under_review: "warning",
  interview: "success",
  offer: "success",
  rejected: "danger",
  needs_user: "warning",
  failed: "danger",
  closed: "default",
};
const PAGE = 24;
/** Which statuses each filter button shows. "sent" also includes anything with a submitted date. */
const FILTER: Record<string, string[] | null> = {
  queued: ["queued"],
  sent: [...SENT],
  needs: ["needs_user"],
  review: ["received", "under_review"],
  screening: ["screening"],
  interview: ["interview", "offer"],
  rejected: ["rejected"],
  all: null,
};

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
  answers?: Record<string, string> | null;
  submitted_at: string | null;
  created_at: string;
  requested_by: string;
  resume_focus: string | null;
  attempts: number | null;
  pending_questions?: PendingQuestion[] | null;
  jobs: { title: string; company_name: string; url: string; job_postings: { posted_at: string | null } | null } | null;
};

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; msg?: string; sort?: string; page?: string; why?: string }> }) {
  const { supabase, user } = await requireUser();
  const t = await timeFmt();
  const sp = await searchParams;
  const sort = sp.sort ?? "newest";
  const page = Math.max(1, Number(sp.page) || 1);

  // Counts come from every application (3 small columns), so these buttons match the dashboard exactly.
  const [all, { data: lastRun }, { data: prof }, { data: needRows }, { data: logins }, ai] = await Promise.all([
    statusRows(supabase, user.id),
    supabase.from("agent_runs").select("started_at,ended_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("profiles").select("custom_answers").eq("id", user.id).maybeSingle(),
    supabase.from("applications").select("id,error,pending_questions,jobs(company_name)").eq("user_id", user.id).eq("status", "needs_user").limit(500),
    supabase.from("application_accounts").select("id,portal_host,email_used,account_created").eq("user_id", user.id),
    aiStatus(serviceClient()),
  ]);
  const c = countPipeline(all);
  const tab = sp.tab && sp.tab in FILTER ? sp.tab : c.needs > 0 ? "needs" : "all";
  const why = (sp.why ?? "") as NeedsKind | "";

  // Questions the agent couldn't answer, merged across applications, minus any answered since.
  const mine = customStore(prof?.custom_answers as CustomAnswers | null);
  const asked = new Map<string, AskedQuestion>();
  const kinds = new Map<string, NeedsKind>();
  const kindCount: Partial<Record<NeedsKind, number>> = {};
  for (const r of (needRows ?? []) as unknown as { id: string; error: string | null; pending_questions: PendingQuestion[] | null; jobs: { company_name: string } | null }[]) {
    const open = (r.pending_questions ?? []).filter((q) => !findSimilarAnswer(q.label, q.options ?? [], mine));
    const k = needsKind(r.error, open.length);
    kinds.set(r.id, k);
    kindCount[k] = (kindCount[k] ?? 0) + 1;
    for (const q of open) {
      const company = r.jobs?.company_name ?? "a company";
      const same = asked.get(q.key) ?? [...asked.values()].find((x) => questionSimilarity(x.label, q.label) >= 0.75);
      if (same) {
        if (!same.companies.includes(company)) same.companies.push(company);
      } else asked.set(q.key, { ...q, options: q.options ?? [], companies: [company] });
    }
  }
  const questions = [...asked.values()].sort((a, b) => b.companies.length - a.companies.length);

  // Only the cards on screen are loaded (with answers/timelines), not the whole history.
  const statuses = FILTER[tab];
  const order = sort === "oldest" ? { col: "created_at", asc: true } : sort === "status" ? { col: "status", asc: true } : { col: "created_at", asc: false };
  let q = supabase
    .from("applications")
    .select(
      `id,status,error,apply_url,submitted_at,created_at,requested_by,resume_focus,attempts,jobs(title,company_name,url,job_postings(posted_at))${tab === "needs" ? ",answers,pending_questions" : ""}`,
      { count: "exact" }
    )
    .eq("user_id", user.id);
  if (tab === "sent") q = q.or(`submitted_at.not.is.null,status.in.(${SENT.join(",")})`);
  else if (statuses) q = q.in("status", statuses);
  if (tab === "needs" && why) {
    const ids = [...kinds.entries()].filter(([, k]) => k === why).map(([id]) => id);
    q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  q = q.order(order.col, { ascending: order.asc });
  if (order.col !== "created_at") q = q.order("created_at", { ascending: false });
  const { data, count: filteredCount } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as unknown as Row[];
  if (sort === "company") rows.sort((a, b) => (a.jobs?.company_name ?? "").localeCompare(b.jobs?.company_name ?? ""));
  if (sort === "posted") rows.sort((a, b) => Date.parse(b.jobs?.job_postings?.posted_at ?? "0") - Date.parse(a.jobs?.job_postings?.posted_at ?? "0"));
  const pages = Math.max(1, Math.ceil((filteredCount ?? 0) / PAGE));

  const shownIds = rows.filter((r) => !["needs_user", "queued"].includes(r.status)).map((r) => r.id);
  const { data: evs } = shownIds.length
    ? await supabase.from("application_events").select("application_id,kind,source,detail,created_at").in("application_id", shownIds).order("created_at", { ascending: false })
    : { data: [] as { application_id: string; kind: string; source: string; detail: string | null; created_at: string }[] };
  const events = new Map<string, { kind: string; source: string; detail: string | null; created_at: string }[]>();
  for (const e of evs ?? []) events.set(e.application_id, [...(events.get(e.application_id) ?? []), e]);
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
    const merged = { tab, sort, ...o };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "page" && Number(v) === 1)) p.set(k, String(v));
    return `/applications?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Applications"
        description="Every application, where it stands, and what’s working. Statuses update from your inbox when it’s connected."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <AiStatus data={ai} compact when={t.dateTime} />
            {dispatchConfigured() && <RunNowButton running={running} details />}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <StatButton href={link({ tab: "needs", why: undefined, page: 1 })} label="Needs you" value={c.needs} tone="warning" active={tab === "needs"} />
        <StatButton href={link({ tab: "queued", why: undefined, page: 1 })} label="Queued" value={c.queued} active={tab === "queued"} />
        <StatButton href={link({ tab: "sent", why: undefined, page: 1 })} label="Sent" value={c.sent} tone="info" active={tab === "sent"} />
        <StatButton href={link({ tab: "review", why: undefined, page: 1 })} label="In review" value={c.inReview} tone="info" active={tab === "review"} />
        <StatButton href={link({ tab: "screening", why: undefined, page: 1 })} label="Screening" value={c.screening} tone="info" active={tab === "screening"} />
        <StatButton href={link({ tab: "interview", why: undefined, page: 1 })} label="Interviews" value={c.interviews} tone="success" active={tab === "interview"} />
        <StatButton href={link({ tab: "rejected", why: undefined, page: 1 })} label="Rejected" value={c.rejected} tone="danger" active={tab === "rejected"} />
        <StatButton href={link({ tab: "all", why: undefined, page: 1 })} label="All" value={c.total} active={tab === "all"} />
      </div>

      {sp.msg && (
        <div className="mb-4">
          <Notice tone={/couldn't/i.test(sp.msg) ? "danger" : "success"}>{sp.msg}</Notice>
        </div>
      )}

      {tab === "needs" ? (
        <>
          <PendingQuestions questions={questions} />
          <div className="mb-4 flex flex-wrap gap-1.5">
            <Link href={link({ why: undefined, page: 1 })} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${!why ? "bg-[var(--accent-soft)] text-[#c3baff] ring-[var(--accent)]/30" : "text-[var(--muted)] ring-[var(--border)] hover:text-[var(--foreground)]"}`}>
              All reasons ({c.needs})
            </Link>
            {(Object.keys(NEEDS_LABEL) as NeedsKind[])
              .filter((k) => kindCount[k])
              .map((k) => (
                <Link
                  key={k}
                  href={link({ why: k, page: 1 })}
                  title={NEEDS_LABEL[k].hint}
                  className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${why === k ? "bg-amber-400/10 text-amber-200 ring-amber-400/40" : "text-[var(--muted)] ring-[var(--border)] hover:text-[var(--foreground)]"}`}
                >
                  {NEEDS_LABEL[k].label} ({kindCount[k]})
                </Link>
              ))}
          </div>
          {why && NEEDS_LABEL[why]?.hint && <p className="-mt-2 mb-4 text-xs text-[var(--muted)]">{NEEDS_LABEL[why].hint}</p>}
        </>
      ) : (
        questions.length > 0 && (
          <div className="mb-5">
            <Notice tone="warning">
              {questions.length} question{questions.length === 1 ? " is" : "s are"} holding up applications.{" "}
              <Link href="/applications?tab=needs#questions" className="font-medium underline">
                Answer {questions.length === 1 ? "it" : "them"} once →
              </Link>
            </Notice>
          </div>
        )
      )}

      {c.queued > 0 && tab === "queued" && (
        <Card className="mb-5 border-[var(--accent)]/30 bg-gradient-to-r from-[var(--accent-soft)] to-transparent p-4">
          <p className="text-sm">
            {running
              ? `The agent is applying right now (started ${ago(lastRun?.started_at)}).`
              : `${c.queued} waiting — next scheduled run ~${t.time(next, true)} (GitHub may start it late).`}{" "}
            <span className="text-[var(--muted)]">Freshest postings go first, max 10 per company per day.{lastRun && !running ? ` Last run ${ago(lastRun.started_at)} (${lastRun.status}).` : ""}</span>
          </p>
        </Card>
      )}

      {byFamily.length > 0 && (tab === "sent" || tab === "all") && (
        <details className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            What’s working: response rate by job type{" "}
            <Link href="/resumes" className="ml-2 text-xs font-normal text-[var(--accent)] hover:underline">
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
                <div className="mt-1 h-1.5 rounded-full bg-white/5">
                  <div className="h-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]" style={{ width: `${Math.round((100 * v.good) / v.sent)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {c.total === 0 && <EmptyState message="No applications yet. Click Apply on a matched job, ask in Chat, or turn on auto-submit." />}
      {c.total > 0 && rows.length === 0 && <EmptyState message="Nothing here right now." />}

      {rows.length > 0 && <BulkBar back={link({ page })} sort={sort} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const timeline = events.get(r.id) ?? [];
          const answers = readable(r.answers ?? null);
          const login = loginByHost.get(hostOf(r.apply_url ?? r.jobs?.url));
          const posted = ago(r.jobs?.job_postings?.posted_at);
          const kind = r.status === "needs_user" ? kinds.get(r.id) : undefined;
          const waiting = (r.pending_questions ?? []).filter((x) => !findSimilarAnswer(x.label, x.options ?? [], mine));
          return (
            <Card key={r.id} className="flex flex-col p-3.5 transition hover:border-[var(--border-strong)]">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  form="bulk"
                  name="ids"
                  value={r.id}
                  aria-label={`Select ${r.jobs?.title ?? "application"} at ${r.jobs?.company_name ?? ""}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-snug" title={r.jobs?.title}>
                    {r.jobs?.title ?? "Job"}
                  </p>
                  <p className="truncate text-xs text-[var(--muted)]">{r.jobs?.company_name}</p>
                </div>
                <Badge variant={VARIANT[r.status] ?? "default"}>{STAGE_LABEL[r.status] === "Queued for next run" ? "Queued" : STAGE_LABEL[r.status] ?? r.status}</Badge>
              </div>

              <p className="mt-2 text-[11px] text-[var(--muted)]">
                {r.submitted_at ? `Applied ${t.dateTime(r.submitted_at)}` : `Added ${t.date(r.created_at)}`}
                {posted ? ` · posted ${posted}` : ""}
                {r.requested_by === "user" ? " · by you" : ""}
              </p>
              {r.resume_focus && <p className="truncate text-[11px] text-[var(--muted)]">Resume: {r.resume_focus}</p>}
              <StageTrack status={r.status} history={timeline.map((e) => e.kind)} />

              {kind && <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-amber-300">{NEEDS_LABEL[kind].label}</p>}
              {r.error && ["needs_user", "queued", "failed"].includes(r.status) && (
                <p className={`mt-1 line-clamp-3 text-xs ${r.status === "queued" ? "text-[var(--muted)]" : "text-amber-200/90"}`} title={r.error}>
                  {r.error}
                  {r.status === "queued" && (r.attempts ?? 0) > 0 ? ` (try ${(r.attempts ?? 0) + 1} of 3)` : ""}
                </p>
              )}
              {waiting.length > 0 && (
                <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
                  Waiting on: {waiting.map((x) => x.label).slice(0, 3).join(" · ")}{" "}
                  <a href="#questions" className="text-[var(--accent)] hover:underline">
                    answer ↑
                  </a>
                </p>
              )}

              {login && r.status === "needs_user" && (
                <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--background-2)] p-2 text-xs">
                  <p className="text-[var(--muted)]">
                    {login.portal_host} {login.account_created ? "· account created" : "· create the account with:"}
                  </p>
                  <p className="mt-0.5 truncate">
                    <code className="rounded bg-white/5 px-1">{login.email_used}</code>
                  </p>
                  <div className="mt-0.5">
                    <RevealPassword id={login.id} />
                  </div>
                </div>
              )}

              {answers.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-[var(--muted)]">Prepared answers ({answers.length})</summary>
                  <dl className="mt-1.5 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {answers.slice(0, 40).map(([q2, a]) => (
                      <div key={q2} className="rounded-md bg-[var(--background-2)] p-1.5">
                        <dt className="text-[var(--muted)]">{q2}</dt>
                        <dd className="mt-0.5 select-all">{String(a)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}

              {!["needs_user", "queued"].includes(r.status) && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-[var(--muted)]">Timeline & status ({timeline.length})</summary>
                  <ol className="mt-1.5 space-y-1 border-l border-[var(--border)] pl-2.5">
                    {timeline.map((e, i) => (
                      <li key={i}>
                        <span className="text-[var(--muted)]">{t.date(e.created_at)}</span> · {STAGE_LABEL[e.kind] ?? e.kind}
                        <span className="text-[var(--muted)]"> ({e.source === "email" ? "inbox" : e.source === "agent" ? "agent" : "you"})</span>
                        {e.detail ? ` — ${e.detail}` : ""}
                      </li>
                    ))}
                    {timeline.length === 0 && <li className="text-[var(--muted)]">No updates yet.</li>}
                  </ol>
                  <form action={setApplicationStatus.bind(null, r.id)} className="mt-2 flex flex-wrap gap-1.5">
                    <select name="status" defaultValue={r.status} className="rounded-lg border border-[var(--border)] bg-[var(--background-2)] px-1.5 py-1 text-xs">
                      {["submitted", "received", "under_review", "screening", "interview", "offer", "rejected", "withdrawn"].map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <input name="note" placeholder="Note" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background-2)] px-2 py-1 text-xs" />
                    <button className={buttonCls("secondary", "sm")}>Save</button>
                  </form>
                </details>
              )}

              <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                {(r.apply_url || r.jobs?.url) && (
                  <a href={r.apply_url ?? r.jobs?.url} target="_blank" rel="noopener noreferrer" className={buttonCls(r.status === "needs_user" ? "primary" : "secondary", "sm")}>
                    {r.status === "needs_user" ? "Open ↗" : "Posting ↗"}
                  </a>
                )}
                {r.status === "needs_user" && (
                  <form action={markApplied.bind(null, r.id)}>
                    <button className={buttonCls("secondary", "sm")}>I applied</button>
                  </form>
                )}
                {["needs_user", "failed"].includes(r.status) && (
                  <form action={retryApplication.bind(null, r.id)}>
                    <button className={buttonCls("ghost", "sm")} title="Put it back in the queue">
                      Retry
                    </button>
                  </form>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2 text-sm" aria-label="Pages">
          {page > 1 && (
            <Link href={link({ page: page - 1, why: why || undefined })} className={buttonCls("secondary", "sm")}>
              ← Newer
            </Link>
          )}
          <span className="text-[var(--muted)]">
            Page {page} of {pages} · {filteredCount} applications
          </span>
          {page < pages && (
            <Link href={link({ page: page + 1, why: why || undefined })} className={buttonCls("secondary", "sm")}>
              Older →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
