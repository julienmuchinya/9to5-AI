import Link from "next/link";
import { requireUser } from "@/lib/v2/session";
import { Badge, Card, EmptyState, Notice, PageHeader, StatCard, TabLink, buttonCls } from "@/components/ui";
import { customStore, findSimilarAnswer, questionSimilarity, type CustomAnswers, type PendingQuestion } from "@/lib/v2/app-questions";
import { PendingQuestions, type AskedQuestion } from "./pending-questions";
import { STAGE_LABEL, roleFamily } from "@/lib/v2/tracking";
import { ago } from "@/lib/v2/priority";
import { dispatchConfigured, nextScheduledRun } from "@/lib/v2/dispatch";
import { RunNowButton } from "@/components/run-now";
import { RevealPassword } from "../accounts/reveal";
import { markApplied, retryApplication, setApplicationStatus } from "../actions";

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
const TABS = [
  ["active", "In progress"],
  ["queued", "Queued"],
  ["needs", "Needs you"],
  ["interview", "Interviews & offers"],
  ["rejected", "Rejected"],
  ["all", "All"],
] as const;

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

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; msg?: string }> }) {
  const { supabase, user } = await requireUser();
  const { tab = "active", msg } = await searchParams;
  const [{ data }, { data: evs }, { data: logins }, { data: lastRun }, { data: prof }] = await Promise.all([
    supabase
      .from("applications")
      .select("id,status,error,apply_url,answers,submitted_at,created_at,requested_by,resume_focus,status_updated_at,attempts,pending_questions,jobs(title,company_name,url,job_postings(posted_at))")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(400),
    supabase.from("application_events").select("application_id,kind,source,detail,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1000),
    supabase.from("application_accounts").select("id,portal_host,email_used,account_created").eq("user_id", user.id),
    supabase.from("agent_runs").select("started_at,ended_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("profiles").select("custom_answers").eq("id", user.id).maybeSingle(),
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
    attempts: number | null;
    pending_questions: PendingQuestion[] | null;
    jobs: { title: string; company_name: string; url: string; job_postings: { posted_at: string | null } | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const events = new Map<string, { kind: string; source: string; detail: string | null; created_at: string }[]>();
  for (const e of evs ?? []) events.set(e.application_id, [...(events.get(e.application_id) ?? []), e]);
  const loginByHost = new Map((logins ?? []).map((l) => [l.portal_host as string, l]));

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
  const queuedCount = count(["queued"]);
  const next = nextScheduledRun();
  const running = lastRun?.status === "running";

  // Questions the agent couldn't answer, merged across applications (same or near-identical wording),
  // minus any the user has already answered since.
  const mine = customStore(prof?.custom_answers as CustomAnswers | null);
  const asked = new Map<string, AskedQuestion>();
  for (const r of rows) {
    if (r.status !== "needs_user") continue;
    for (const q of r.pending_questions ?? []) {
      if (findSimilarAnswer(q.label, q.options ?? [], mine)) continue;
      const company = r.jobs?.company_name ?? "a company";
      const same = asked.get(q.key) ?? [...asked.values()].find((x) => questionSimilarity(x.label, q.label) >= 0.75);
      if (same) {
        if (!same.companies.includes(company)) same.companies.push(company);
      } else asked.set(q.key, { ...q, options: q.options ?? [], companies: [company] });
    }
  }
  const questions = [...asked.values()].sort((a, b) => b.companies.length - a.companies.length);

  const filtered = rows.filter((r) => {
    if (tab === "needs") return r.status === "needs_user";
    if (tab === "queued") return r.status === "queued";
    if (tab === "interview") return ["interview", "offer"].includes(r.status);
    if (tab === "rejected") return r.status === "rejected";
    if (tab === "active") return ["queued", "submitted", "received", "under_review"].includes(r.status);
    return true;
  });

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Applications"
        description="Every application, where it stands, and what’s working. Statuses update from your inbox when it’s connected."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Queued" value={queuedCount} />
        <StatCard label="Sent" value={sent.length} />
        <StatCard label="Needs you" value={count(["needs_user"])} variant={count(["needs_user"]) ? "warning" : "default"} />
        <StatCard label="In review" value={count(["received", "under_review"])} />
        <StatCard label="Interviews" value={count(["interview", "offer"])} variant="success" />
        <StatCard label="Rejected" value={count(["rejected"])} variant="danger" />
      </div>

      {msg && (
        <div className="mb-4">
          <Notice tone={/couldn't/i.test(msg) ? "danger" : "success"}>{msg}</Notice>
        </div>
      )}

      {tab === "needs" ? (
        <PendingQuestions questions={questions} />
      ) : (
        questions.length > 0 && (
          <div className="mb-6">
            <Notice tone="warning">
              {questions.length} question{questions.length === 1 ? " is" : "s are"} holding up applications.{" "}
              <Link href="/applications?tab=needs#questions" className="font-medium underline">
                Answer {questions.length === 1 ? "it" : "them"} once →
              </Link>
            </Notice>
          </div>
        )
      )}

      {queuedCount > 0 && (
        <Card className="mb-6 border-[var(--accent)]/30 bg-gradient-to-r from-[var(--accent-soft)] to-transparent">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">
                {running ? "The agent is applying right now" : `${queuedCount} application${queuedCount === 1 ? "" : "s"} waiting for the agent`}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {running
                  ? `Run started ${ago(lastRun?.started_at)}. Freshest postings go first, max 5 per company per day.`
                  : `Queued jobs are applied to on the next agent run — next scheduled run ${next.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", weekday: "short", timeZoneName: "short" })}. Freshest postings go first, max 5 per company per day.`}
                {lastRun && !running ? ` Last run: ${ago(lastRun.started_at)} (${lastRun.status}).` : ""}
              </p>
            </div>
            {!running && (dispatchConfigured() ? <RunNowButton /> : <span className="text-xs text-[var(--muted)]">“Run now” needs GH_DISPATCH_TOKEN on the server</span>)}
          </div>
        </Card>
      )}

      {sent.length >= 3 && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {[
            ["Response rate by job type", byFamily],
            ["Response rate by resume focus", byFocus],
          ].map(([title, list]) => (
            <Card key={title as string} className="p-4">
              <h2 className="mb-3 text-sm font-semibold">{title as string}</h2>
              {(list as [string, { sent: number; good: number; rejected: number }][]).length === 0 && <p className="text-xs text-[var(--muted)]">Not enough data yet.</p>}
              <div className="space-y-2.5">
                {(list as [string, { sent: number; good: number; rejected: number }][]).map(([k, v]) => (
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
            </Card>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map(([k, label]) => (
          <TabLink key={k} href={`?tab=${k}`} active={tab === k}>
            {label}
            {k === "needs" && count(["needs_user"]) > 0 ? ` (${count(["needs_user"])})` : ""}
            {k === "queued" && queuedCount > 0 ? ` (${queuedCount})` : ""}
          </TabLink>
        ))}
      </div>

      {rows.length === 0 && <EmptyState message="No applications yet. Click Apply on a matched job, ask in Chat, or turn on auto-submit." />}
      {rows.length > 0 && filtered.length === 0 && <EmptyState message="Nothing here right now." />}

      <div className="space-y-3">
        {filtered.map((r) => {
          const timeline = events.get(r.id) ?? [];
          const answers = readable(r.answers);
          const login = loginByHost.get(hostOf(r.apply_url ?? r.jobs?.url));
          const posted = ago(r.jobs?.job_postings?.posted_at);
          return (
            <Card key={r.id} className="p-4 transition hover:border-[var(--border-strong)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{r.jobs?.title ?? "Job"}</p>
                    <Badge variant={VARIANT[r.status] ?? "default"}>{STAGE_LABEL[r.status] ?? r.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {r.jobs?.company_name}
                    {posted ? ` · posted ${posted}` : ""} ·{" "}
                    {r.submitted_at ? `applied ${new Date(r.submitted_at).toLocaleDateString()}` : `added ${new Date(r.created_at).toLocaleDateString()}`} · by {r.requested_by}
                    {r.resume_focus ? ` · resume led with ${r.resume_focus}` : ""}
                  </p>
                  {r.error && ["needs_user", "queued", "failed"].includes(r.status) && (
                    <p className={`mt-2 text-xs ${r.status === "queued" ? "text-[var(--muted)]" : "text-amber-300"}`}>
                      {r.error}
                      {r.status === "queued" && (r.attempts ?? 0) > 0 ? ` (try ${(r.attempts ?? 0) + 1} of 3)` : ""}
                    </p>
                  )}
                  {login && (
                    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--background-2)] p-3 text-sm">
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                        Login for {login.portal_host} {login.account_created ? "· account created" : "· create the account with these"}
                      </p>
                      <p>
                        Email: <code className="rounded-md bg-white/5 px-1.5 py-0.5">{login.email_used}</code>
                      </p>
                      <div className="mt-1">
                        Password: <RevealPassword id={login.id} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {(r.apply_url || r.jobs?.url) && (
                    <a href={r.apply_url ?? r.jobs?.url} target="_blank" rel="noopener noreferrer" className={buttonCls(r.status === "needs_user" ? "primary" : "secondary", "sm")}>
                      {r.status === "needs_user" ? "Open application ↗" : "View posting ↗"}
                    </a>
                  )}
                  {r.status === "needs_user" && (
                    <form action={markApplied.bind(null, r.id)}>
                      <button className={buttonCls("secondary", "sm")}>I applied</button>
                    </form>
                  )}
                  {["needs_user", "failed"].includes(r.status) && (
                    <form action={retryApplication.bind(null, r.id)}>
                      <button className={buttonCls("ghost", "sm")} title="After answering the missing question on your profile">
                        Retry
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {r.status === "needs_user" && (r.pending_questions?.length ?? 0) > 0 && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Waiting on: {(r.pending_questions ?? []).filter((q) => !findSimilarAnswer(q.label, q.options ?? [], mine)).map((q) => q.label).slice(0, 4).join(" · ")}
                  {tab !== "needs" ? (
                    <>
                      {" "}
                      —{" "}
                      <Link href="/applications?tab=needs#questions" className="text-[var(--accent)] hover:underline">
                        answer above
                      </Link>
                    </>
                  ) : null}
                </p>
              )}

              {r.status === "needs_user" && !r.pending_questions?.length && /Needs your answer/.test(r.error ?? "") && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Tip: answer it once under{" "}
                  <Link href="/profile#common-questions" className="text-[var(--accent)] hover:underline">
                    Profile → Common questions
                  </Link>
                  , then click Retry — the agent reuses it on every future application.
                </p>
              )}

              {r.status === "needs_user" && answers.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-[var(--muted)]">Answers the agent prepared ({answers.length}) — copy them into the form</summary>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                    {answers.slice(0, 40).map(([q, a]) => (
                      <div key={q} className="rounded-lg bg-[var(--background-2)] p-2">
                        <dt className="text-xs text-[var(--muted)]">{q}</dt>
                        <dd className="mt-0.5">{String(a)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}

              {!["needs_user", "queued"].includes(r.status) && (
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
                    <select name="status" defaultValue={r.status} className="rounded-xl border border-[var(--border)] bg-[var(--background-2)] px-2 py-1.5 text-sm">
                      {["submitted", "received", "under_review", "interview", "offer", "rejected", "withdrawn"].map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <input name="note" placeholder="Note (optional)" className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background-2)] px-3 py-1.5 text-sm" />
                    <button className={buttonCls("secondary", "sm")}>Save</button>
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
