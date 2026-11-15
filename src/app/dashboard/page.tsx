import Link from "next/link";
import { timeFmt } from "@/lib/tz";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { Badge, Button, Card, CompanyMark, FitBadge, StatCard } from "@/components/ui";
import { dispatchConfigured, nextScheduledRun } from "@/lib/v2/dispatch";
import { RunNowButton } from "@/components/run-now";
import { Icon } from "@/components/sidebar";
import { countPipeline, statusRows } from "@/lib/v2/pipeline";
import { aiStatus } from "@/lib/v2/ai-status";
import { AiStatus } from "@/components/ai-status";
import { priorityScore } from "@/lib/v2/priority";
import { funnel, greeting, hourIn, pct, weekActivity } from "@/lib/v2/overview";
import { toggleSavedJob } from "../actions";

export const dynamic = "force-dynamic";

type TopJob = {
  id: string;
  title: string;
  company_name: string;
  fit_score: number;
  job_postings: { is_remote: boolean; locations: string[]; posted_at: string | null; verification_status: string };
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { supabase, user } = await requireUser();
  const t = await timeFmt();
  const { welcome } = await searchParams;
  const db = serviceClient();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: p }, { data: s }, { count: matched }, apps, { data: runs }, { data: sq }, { data: lastGlobal }, { count: recentErrors }, ai, { data: jobs }, { data: week }, saved] =
    await Promise.all([
      supabase.from("profiles").select("first_name,resume_path,resume_parsed,phone,work_authorized_us,sponsorship_needed,target_roles").eq("id", user.id).maybeSingle(),
      supabase.from("autopilot_settings").select("auto_submit_enabled,paused,daily_apply_cap").eq("user_id", user.id).maybeSingle(),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("dismissed", false),
      statusRows(supabase, user.id),
      supabase.from("agent_runs").select("started_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(5),
      db.from("security_questions").select("user_id").eq("user_id", user.id).maybeSingle(),
      db.from("agent_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("agent_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("level", "error").gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
      aiStatus(db),
      supabase
        .from("jobs")
        .select("id,title,company_name,fit_score, job_postings!inner(is_remote,locations,posted_at,verification_status)")
        .eq("user_id", user.id)
        .eq("dismissed", false)
        .eq("job_postings.verification_status", "verified")
        .order("fit_score", { ascending: false })
        .limit(40),
      supabase.from("applications").select("submitted_at").eq("user_id", user.id).gte("submitted_at", weekAgo).limit(5000),
      // Saved jobs need migration 011; if the column isn't there yet this just errors and saving stays hidden.
      supabase.from("jobs").select("id").eq("user_id", user.id).not("saved_at", "is", null).limit(1000),
    ]);
  // Self-heal accounts created before the sign-up trigger existed.
  if (!p || !s) {
    await Promise.all([
      db.from("profiles").upsert({ id: user.id, job_email: user.email }, { onConflict: "id", ignoreDuplicates: true }),
      db.from("autopilot_settings").upsert({ user_id: user.id, auto_apply_enabled: false, mock_mode: false, emergency_stop: false }, { onConflict: "user_id", ignoreDuplicates: true }),
    ]);
  }
  const parsed = Boolean(p?.resume_parsed && Object.keys(p.resume_parsed as object).length);
  const c = countPipeline(apps);
  const f = funnel(apps);
  const confirmedRate = pct(f.confirmed, f.sent);
  const savedOn = !saved.error;
  const savedIds = new Set((saved.data ?? []).map((r) => r.id as string));

  // Top matches: best verified jobs you haven't applied to, freshest first among equals.
  const { data: appJobs } = await supabase.from("applications").select("job_id").eq("user_id", user.id).limit(20000);
  const applied = new Set((appJobs ?? []).map((a) => a.job_id as string));
  const now = Date.now();
  const top = ((jobs ?? []) as unknown as TopJob[])
    .filter((j) => !applied.has(j.id))
    .sort((a, b) => priorityScore(b.fit_score, b.job_postings.posted_at, now) - priorityScore(a.fit_score, a.job_postings.posted_at, now))
    .slice(0, 4);

  const days = weekActivity((week ?? []).map((r) => r.submitted_at as string | null), t.tz);
  const weekTotal = days.reduce((n, d) => n + d.count, 0);
  const maxDay = Math.max(1, ...days.map((d) => d.count));

  const last = runs?.[0];
  const running = last?.status === "running";
  const agentState = s?.paused ? "paused" : running ? "working" : "ready";

  // Action center: only things you can act on, each linking to the exact place. Max 5.
  const setup = [
    { done: Boolean(p?.resume_path) && parsed, title: p?.resume_path && !parsed ? "Your resume isn't read yet" : "Upload your resume", sub: p?.resume_path && !parsed ? "Click “Read it again” on your profile." : "The agent matches jobs to it.", href: "/profile", icon: "resumes" },
    { done: Boolean((p?.target_roles as string[] | null)?.length), title: "Pick the jobs you want", sub: "Any field — choose from the catalog or type a title.", href: "/profile#roles", icon: "search" },
    { done: Boolean(p?.first_name && p?.phone), title: "Add your contact details", sub: "Employers need a name and phone number.", href: "/profile", icon: "profile" },
    { done: p?.work_authorized_us != null && p?.sponsorship_needed != null, title: "Answer work authorization", sub: "Asked on almost every application.", href: "/profile", icon: "account" },
    { done: Boolean(sq), title: "Set password recovery questions", sub: "So you can get back in if you forget it.", href: "/account", icon: "account" },
  ];
  const tasks = [
    ...((recentErrors ?? 0) > 0 ? [{ title: `${recentErrors} error${recentErrors === 1 ? "" : "s"} in the last 24 hours`, sub: "See what failed and how to fix it.", href: "/status?level=error", icon: "alert", tone: "danger" as const }] : []),
    ...(c.needs > 0 ? [{ title: `${c.needs} application${c.needs === 1 ? " needs" : "s need"} you`, sub: "Questions, sign-ins or CAPTCHAs the agent couldn't finish.", href: "/applications?tab=needs", icon: "alert", tone: "warning" as const }] : []),
    ...setup.filter((x) => !x.done).map((x) => ({ ...x, tone: "accent" as const })),
    ...(c.interviews > 0 ? [{ title: `${c.interviews} interview${c.interviews === 1 ? "" : "s"} in progress`, sub: "Keep notes and next steps on each one.", href: "/applications?tab=interview", icon: "calendar", tone: "success" as const }] : []),
  ].slice(0, 5);
  const toneCls = { danger: "bg-red-400/15 text-red-400", warning: "bg-amber-400/15 text-amber-400", accent: "bg-[var(--accent-soft)] text-[var(--accent)]", success: "bg-emerald-400/15 text-emerald-400" };

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Your job search, simplified</p>
        <h1 className="text-[26px] font-bold tracking-tight sm:text-[32px]">
          {greeting(hourIn(t.tz))}
          {p?.first_name ? `, ${p.first_name}` : ""}
        </h1>
        <p className="mt-1.5 text-[var(--muted)]">Here’s what needs you today, and what your agent is doing.</p>
      </div>

      {welcome && <p className="rounded-xl bg-emerald-900/30 p-3 text-sm text-emerald-300">Your email is confirmed and you’re signed in. The action center below shows how to get your agent working.</p>}

      {/* Hero + agent */}
      <section className="grid gap-5 rounded-3xl border border-[var(--border)] bg-gradient-to-br from-[var(--accent-soft)] to-[var(--card)] p-5 sm:p-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col justify-center">
          <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-text)]">
            <Icon name="sparkle" className="h-3.5 w-3.5" /> Your job agent
          </p>
          <h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">Focus on the jobs that move you forward.</h2>
          <p className="mt-3 max-w-xl text-[var(--muted)]">
            {matched ?? 0} matched jobs from verified employers and job boards. Your agent checks each employer and applies where it can — anything it can’t finish comes back to you.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button href="/jobs">
              Explore matching jobs <Icon name="arrow" className="h-4 w-4" />
            </Button>
            <Button href="/applications" variant="secondary">
              View pipeline
            </Button>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] p-5 text-white shadow-[0_18px_40px_-20px_var(--accent)]">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border border-white/20" aria-hidden />
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/80">
            <Icon name="sparkle" className="h-3.5 w-3.5" /> Agent
          </p>
          <p className="mt-2 text-xl font-bold">{agentState === "paused" ? "Paused" : agentState === "working" ? "Working now" : "Ready"}</p>
          <p className="mt-2 text-sm text-white/85">
            {agentState === "paused"
              ? "It won’t look for jobs or apply until you resume it in settings or chat."
              : `Runs about every 2 hours — next ~${t.time(nextScheduledRun(), true)}.`}{" "}
            {s?.auto_submit_enabled ? `Auto-submit is on (max ${s?.daily_apply_cap}/day).` : "Auto-submit is off: it only applies to jobs you queue."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {dispatchConfigured() && !s?.paused && <RunNowButton running={running} compact />}
            <Link href="/settings" className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-[#3b31c9] hover:bg-white/90">
              Autopilot settings
            </Link>
            <Link href="/chat" className="rounded-lg px-3 py-1.5 text-sm font-medium text-white ring-1 ring-inset ring-white/40 hover:bg-white/10">
              Chat
            </Link>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Link href="/applications?tab=all" className="block rounded-2xl transition hover:-translate-y-0.5">
          <StatCard label="Applications" value={c.total} sub={`${c.queued} queued · ${c.sent} sent`} icon={<Icon name="briefcase" />} />
        </Link>
        <Link href="/applications?tab=needs" className="block rounded-2xl transition hover:-translate-y-0.5">
          <StatCard label="Needs you" value={c.needs} variant={c.needs > 0 ? "warning" : "default"} sub="Questions, sign-ins, CAPTCHAs" icon={<Icon name="clock" />} />
        </Link>
        <Link href="/applications?tab=interview" className="block rounded-2xl transition hover:-translate-y-0.5">
          <StatCard label="Interviews" value={c.interviews} variant="success" sub="Interview or offer stage" icon={<Icon name="calendar" />} />
        </Link>
        <Link href="/applications?tab=sent" className="block rounded-2xl transition hover:-translate-y-0.5">
          <StatCard
            label="Confirmed received"
            value={confirmedRate == null ? "—" : `${confirmedRate}%`}
            variant="success"
            sub={f.sent ? `${f.confirmed} of ${f.sent} sent, from your inbox` : "Nothing sent yet"}
            icon={<Icon name="check" />}
          />
        </Link>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Top matches */}
        <Card className="p-5 sm:p-6">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Top matches for you</h2>
              <p className="text-sm text-[var(--muted)]">Verified employers, ranked by fit and freshness</p>
            </div>
            <Link href="/jobs" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-[var(--accent-text)] hover:underline">
              View all <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          {top.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--muted)]">
              {parsed ? "No new verified matches right now — the agent looks again on its next run." : "Start with your resume and the jobs you want — matches appear after the next run."}
              <div className="mt-3">
                <Button href={parsed ? "/profile#roles" : "/profile"} variant="secondary" size="sm">
                  {parsed ? "Adjust matching preferences" : "Set up your profile"}
                </Button>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {top.map((j) => (
                <li key={j.id} className="flex items-center gap-3 py-3">
                  <CompanyMark name={j.company_name} />
                  <Link href={`/jobs?job=${j.id}`} className="min-w-0 flex-1 rounded-lg hover:text-[var(--accent-text)]">
                    <p className="truncate font-semibold">{j.title}</p>
                    <p className="truncate text-sm text-[var(--muted)]">
                      {j.company_name} · {j.job_postings.is_remote ? "Remote" : j.job_postings.locations.slice(0, 1).join("") || "On-site"}
                    </p>
                  </Link>
                  <FitBadge score={j.fit_score} />
                  {savedOn && (
                    <form action={toggleSavedJob.bind(null, j.id, !savedIds.has(j.id))}>
                      <button
                        className={`grid h-10 w-10 place-items-center rounded-lg transition hover:bg-[var(--hover)] ${savedIds.has(j.id) ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)]"}`}
                        aria-pressed={savedIds.has(j.id)}
                        aria-label={savedIds.has(j.id) ? `Remove ${j.title} from saved` : `Save ${j.title}`}
                      >
                        <Icon name="bookmark" />
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          {/* Action center */}
          <Card className="p-5 sm:p-6">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Action center</h2>
                <p className="text-sm text-[var(--muted)]">Only what needs you</p>
              </div>
              {tasks.length > 0 && <Badge variant="warning">{tasks.length} task{tasks.length === 1 ? "" : "s"}</Badge>}
            </div>
            {tasks.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-300">
                <Icon name="check" /> You’re all caught up.
              </p>
            ) : (
              <ul className="space-y-1">
                {tasks.map((x) => (
                  <li key={x.title}>
                    <Link href={x.href} className="flex items-start gap-3 rounded-xl p-2 transition hover:bg-[var(--hover)]">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneCls[x.tone]}`}>
                        <Icon name={x.icon} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{x.title}</span>
                        <span className="block text-xs text-[var(--muted)]">{x.sub}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Week at a glance */}
          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Your week at a glance</h2>
                <p className="text-sm text-[var(--muted)]">Applications sent per day</p>
              </div>
              <Badge variant="accent">{weekTotal} this week</Badge>
            </div>
            <div className="flex h-28 items-end gap-2" role="img" aria-label={`Applications sent in the last 7 days: ${days.map((d) => `${d.label} ${d.count}`).join(", ")}`}>
              {days.map((d, i) => (
                <div key={d.key} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] tabular-nums text-[var(--muted)]">{d.count || ""}</span>
                  <div
                    className={`w-full max-w-7 rounded-md ${i === 6 ? "bg-[var(--accent)]" : "bg-[var(--accent-soft)]"}`}
                    style={{ height: `${Math.max(6, (d.count / maxDay) * 80)}px` }}
                  />
                  <span className="text-[11px] text-[var(--muted)]">{d.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Agent details: kept small and below the fold. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">AI status</h2>
            <Link href="/usage" className="text-xs text-[var(--accent-text)] hover:underline">
              Details
            </Link>
          </div>
          <AiStatus data={ai} when={t.dateTime} />
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Recent runs</h2>
            <Link href="/status" className="text-xs text-[var(--accent-text)] hover:underline">
              System status
            </Link>
          </div>
          {!last ? (
            <p className="text-sm text-[var(--muted)]">
              No runs for your account yet. {parsed ? "Your resume is ready, so the next run picks you up" : "Once your resume is read, the next run picks you up"}
              {lastGlobal?.started_at ? ` (last agent run: ${t.dateTime(lastGlobal.started_at)}).` : "."}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(runs ?? []).map((r, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-[var(--muted)]">{t.dateTime(r.started_at)}</span>
                  <span>{r.status === "completed" ? `${(r.summary as { matched?: number })?.matched ?? 0} matched` : r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
