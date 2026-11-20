import Link from "next/link";
import { redirect } from "next/navigation";
import { timeFmt } from "@/lib/tz";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { Emphasis, FitBadge, Overline, StatStrip } from "@/components/ui";
import { dispatchConfigured, nextScheduledRun } from "@/lib/v2/dispatch";
import { RunNowButton } from "@/components/run-now";
import { DeskButton } from "@/components/sidebar";
import { countPipeline, statusRows } from "@/lib/v2/pipeline";
import { aiStatus } from "@/lib/v2/ai-status";
import { AiStatus } from "@/components/ai-status";
import { ago, priorityScore } from "@/lib/v2/priority";
import { dailyOutcomes, funnel, greeting, hourIn, pct, weekActivity } from "@/lib/v2/overview";
import { STAGE_LABEL } from "@/lib/v2/tracking";
import { toggleSavedJob } from "../actions";

export const dynamic = "force-dynamic";

type TopJob = {
  id: string;
  title: string;
  company_name: string;
  fit_score: number;
  job_postings: { is_remote: boolean; locations: string[]; posted_at: string | null; verification_status: string; salary_min: number | null; salary_max: number | null };
};

const pay = (a: number | null, b: number | null) => (b ? `$${Math.round((a ?? b) / 1000)}k${a && a !== b ? `–${Math.round(b / 1000)}k` : ""}` : "Pay not listed");

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { supabase, user } = await requireUser();
  const t = await timeFmt();
  const { welcome } = await searchParams;
  const db = serviceClient();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: p }, { data: s }, apps, { data: runs }, { data: sq }, { data: lastGlobal }, { count: recentErrors }, ai, { data: jobs }, { data: week }, saved, { data: talks }] = await Promise.all([
    supabase.from("profiles").select("first_name,resume_path,resume_parsed,phone,work_authorized_us,sponsorship_needed,target_roles").eq("id", user.id).maybeSingle(),
    supabase.from("autopilot_settings").select("auto_submit_enabled,paused,daily_apply_cap").eq("user_id", user.id).maybeSingle(),
    statusRows(supabase, user.id),
    supabase.from("agent_runs").select("started_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(5),
    db.from("security_questions").select("user_id").eq("user_id", user.id).maybeSingle(),
    db.from("agent_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("agent_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("level", "error").gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
    aiStatus(db),
    supabase
      .from("jobs")
      .select("id,title,company_name,fit_score, job_postings!inner(is_remote,locations,posted_at,verification_status,salary_min,salary_max)")
      .eq("user_id", user.id)
      .eq("dismissed", false)
      .eq("job_postings.verification_status", "verified")
      .order("fit_score", { ascending: false })
      .limit(60),
    supabase.from("applications").select("submitted_at").eq("user_id", user.id).gte("submitted_at", weekAgo).limit(5000),
    supabase.from("jobs").select("id").eq("user_id", user.id).not("saved_at", "is", null).limit(1000),
    supabase.from("applications").select("id,status,status_updated_at,submitted_at,created_at,jobs(title,company_name)").eq("user_id", user.id).in("status", ["interview", "screening", "offer"]).order("status_updated_at", { ascending: false, nullsFirst: false }).limit(3),
  ]);
  // Overview: the last 14 days of outcomes and the latest updates.
  const since14 = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [{ data: recentApps }, { data: updates }] = await Promise.all([
    supabase.from("applications").select("status,submitted_at,status_updated_at,created_at").eq("user_id", user.id).or(`submitted_at.gte.${since14},status_updated_at.gte.${since14}`).limit(5000),
    supabase
      .from("application_events")
      .select("id,kind,source,detail,created_at,application_id, applications(status, jobs(title,company_name))")
      .eq("user_id", user.id)
      .neq("kind", "queued")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  // Self-heal accounts created before the sign-up trigger existed.
  if (!p || !s) {
    await Promise.all([
      db.from("profiles").upsert({ id: user.id, job_email: user.email }, { onConflict: "id", ignoreDuplicates: true }),
      db.from("autopilot_settings").upsert({ user_id: user.id, auto_apply_enabled: false, mock_mode: false, emergency_stop: false }, { onConflict: "user_id", ignoreDuplicates: true }),
    ]);
  }
  const parsed = Boolean(p?.resume_parsed && Object.keys(p.resume_parsed as object).length);
  const hasRoles = Boolean((p?.target_roles as string[] | null)?.length);
  // Brand-new account straight from sign-up: start with the three-step setup.
  if (welcome && !parsed && !hasRoles) redirect("/start");

  const c = countPipeline(apps);
  const f = funnel(apps);
  const savedOn = !saved.error;
  const savedIds = new Set((saved.data ?? []).map((r) => r.id as string));

  const { data: appJobs } = await supabase.from("applications").select("job_id").eq("user_id", user.id).limit(20000);
  const applied = new Set((appJobs ?? []).map((a) => a.job_id as string));
  const now = Date.now();
  const fresh = ((jobs ?? []) as unknown as TopJob[]).filter((j) => !applied.has(j.id));
  const top = [...fresh].sort((a, b) => priorityScore(b.fit_score, b.job_postings.posted_at, now) - priorityScore(a.fit_score, a.job_postings.posted_at, now)).slice(0, 5);
  const newThisWeek = fresh.filter((j) => j.job_postings.posted_at && j.job_postings.posted_at >= weekAgo).length;

  const outcomes = dailyOutcomes((recentApps ?? []) as { status: string; submitted_at: string | null; status_updated_at: string | null; created_at: string }[], t.tz, 14);
  const today = outcomes[outcomes.length - 1];
  const maxOutcome = Math.max(1, ...outcomes.map((d) => d.sent + d.needs + d.failed));
  const days = weekActivity((week ?? []).map((r) => r.submitted_at as string | null), t.tz);
  const weekTotal = days.reduce((n, d) => n + d.count, 0);
  const maxDay = Math.max(1, ...days.map((d) => d.count));

  const last = runs?.[0];
  const running = last?.status === "running";
  const agentState = s?.paused ? "paused" : running ? "working" : "ready";
  const weekday = new Date().toLocaleDateString("en-US", { timeZone: t.tz, weekday: "long" });

  // Your attention, please: only things you can act on, each linking to the exact place. Max 5.
  const setup = [
    { done: Boolean(p?.resume_path) && parsed, title: p?.resume_path && !parsed ? "Your resume isn’t read yet" : "Add your resume", sub: p?.resume_path && !parsed ? "Open your profile and choose “Read it again”." : "Matching starts from it.", href: p?.resume_path ? "/profile" : "/start", meta: "2 min" },
    { done: hasRoles, title: "Choose the work you want", sub: "Any field — pick from the catalog or type a title.", href: "/start", meta: "1 min" },
    { done: Boolean(p?.first_name && p?.phone), title: "Add your contact details", sub: "Employers need a name and a phone number.", href: "/profile", meta: "1 min" },
    { done: p?.work_authorized_us != null && p?.sponsorship_needed != null, title: "Answer work authorization", sub: "Asked on almost every application.", href: "/profile", meta: "1 min" },
    { done: Boolean(sq), title: "Set password recovery questions", sub: "So you can always get back in.", href: "/account", meta: "2 min" },
  ];
  const tasks = [
    ...((recentErrors ?? 0) > 0 ? [{ title: `${recentErrors} problem${recentErrors === 1 ? "" : "s"} in the last day`, sub: "See what failed and how to fix it.", href: "/status?level=error", meta: "Check" }] : []),
    ...(c.needs > 0 ? [{ title: `Finish ${c.needs} application${c.needs === 1 ? "" : "s"}`, sub: "Questions, sign-ins or checks the agent couldn’t do alone.", href: "/applications?tab=needs", meta: `${c.needs} waiting` }] : []),
    ...setup.filter((x) => !x.done),
    ...(c.queued > 0 ? [{ title: `${c.queued} queued for the next run`, sub: `The agent starts ~${t.time(nextScheduledRun(), true)}.`, href: "/applications?tab=queued", meta: "Queued" }] : []),
  ].slice(0, 5);

  const horizon = [
    ...((talks ?? []) as unknown as { id: string; status: string; status_updated_at: string | null; submitted_at: string | null; created_at: string; jobs: { title: string; company_name: string } | null }[]).map((a) => ({
      when: new Date(a.status_updated_at ?? a.submitted_at ?? a.created_at).toLocaleDateString("en-US", { timeZone: t.tz, month: "short", day: "numeric" }),
      title: a.jobs?.company_name ?? "Application",
      sub: `${a.status === "offer" ? "Offer" : a.status === "interview" ? "Interview stage" : "Screening"} · ${a.jobs?.title ?? ""}`,
      href: `/applications?tab=interview&app=${a.id}`,
    })),
    ...(s?.paused
      ? []
      : [{ when: new Date(nextScheduledRun()).toLocaleDateString("en-US", { timeZone: t.tz, month: "short", day: "numeric" }), title: "Next agent run", sub: `Around ${t.time(nextScheduledRun())} — new matches and your queue`, href: "/status" }]),
  ].slice(0, 4);

  return (
    <div>
      {/* Masthead */}
      <div className="mb-4 flex items-center justify-between gap-4 animate-fade-up">
        <Overline>The {weekday} edition</Overline>
        <p className="kicker hidden sm:block">No. {String(c.total).padStart(3, "0")} / your search</p>
      </div>
      <div className="mb-10 grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <h1 className="display text-[44px] sm:text-[64px] lg:text-[76px]">
          <Emphasis text="A better *next* move." />
        </h1>
        <p className="text-[15px] leading-relaxed text-[var(--muted)]">
          {greeting(hourIn(t.tz))}
          {p?.first_name ? `, ${p.first_name}` : ""}. Less scrolling, more momentum — here’s everything worth your attention today.
        </p>
      </div>

      {welcome && (
        <p role="status" className="mb-8 border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
          Your email is confirmed and you’re in. The list below shows what to do first.
        </p>
      )}

      {/* Overview: today at a glance, the last two weeks, and the latest updates. */}
      <section aria-labelledby="overview" className="mb-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="overview" className="display text-[30px]">
            Today at a glance.
          </h2>
          <Link href="/applications?tab=all" className="min-h-[44px] text-sm font-semibold underline underline-offset-4">
            All applications ↗
          </Link>
        </div>
        <div className="mt-4">
          <StatStrip
            items={[
              { value: today.sent, label: "Sent today", href: "/applications?tab=sent" },
              { value: today.needs, label: "Came back to you today", href: "/applications?tab=needs", tone: today.needs ? "warning" : undefined },
              { value: today.failed, label: "Failed today", href: "/applications?tab=failed" },
              { value: c.queued, label: "Queued for the agent", href: "/applications?tab=queued" },
              { value: c.needs, label: "Need you in total", href: "/applications?tab=needs", tone: c.needs ? "warning" : undefined },
            ]}
          />
        </div>
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="kicker">Last 14 days · what happened each day</p>
              <p className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-[var(--accent)]" aria-hidden /> Sent
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-[var(--orange)]" aria-hidden /> Needs you
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-red-400" aria-hidden /> Failed
                </span>
              </p>
            </div>
            <div
              className="mt-4 flex h-44 items-end gap-1.5 border-b border-[var(--border)]"
              role="img"
              aria-label={`Last 14 days: ${outcomes.map((d) => `${d.label}: ${d.sent} sent, ${d.needs} need you, ${d.failed} failed`).join("; ")}`}
            >
              {outcomes.map((d, i) => {
                const total = d.sent + d.needs + d.failed;
                const h = (n: number) => `${(n / maxOutcome) * 140}px`;
                return (
                  <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${d.sent} sent, ${d.needs} need you, ${d.failed} failed`}>
                    <span className="font-mono text-[10px] text-[var(--muted)]">{total || ""}</span>
                    <div className="flex w-full max-w-7 flex-col-reverse">
                      <div className="bg-[var(--accent)]" style={{ height: h(d.sent) }} />
                      <div className="bg-[var(--orange)]" style={{ height: h(d.needs) }} />
                      <div className="bg-red-400" style={{ height: h(d.failed) }} />
                      {!total && <div className="h-[3px] bg-[var(--border)]" />}
                    </div>
                    <span className={`font-mono text-[9px] sm:text-[10px] ${i === outcomes.length - 1 ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
                      {i === outcomes.length - 1 ? "Today" : d.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Two weeks: {outcomes.reduce((n, d) => n + d.sent, 0)} sent · {outcomes.reduce((n, d) => n + d.needs, 0)} came back to you · {outcomes.reduce((n, d) => n + d.failed, 0)} failed.
            </p>
          </div>
          <div>
            <p className="kicker">Latest updates</p>
            <ul className="mt-3 border-t border-[var(--foreground)]">
              {(updates ?? []).length === 0 && <li className="py-5 text-sm text-[var(--muted)]">Updates appear here as the agent applies and employers reply.</li>}
              {(
                (updates ?? []) as unknown as {
                  id: string;
                  kind: string;
                  source: string;
                  detail: string | null;
                  created_at: string;
                  application_id: string;
                  applications: { status: string; jobs: { title: string; company_name: string } | null } | null;
                }[]
              ).map((u) => (
                <li key={u.id} className="border-b border-[var(--border)]">
                  <Link href={`/applications?tab=all&app=${u.application_id}`} className="block py-3 hover:bg-[var(--hover)]">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold">{u.applications?.jobs?.company_name ?? "Application"}</span>
                      <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">{ago(u.created_at, now) || t.date(u.created_at)}</span>
                    </span>
                    <span className="block truncate text-sm text-[var(--muted)]">
                      {u.kind === "note" && u.detail ? u.detail : (STAGE_LABEL[u.kind] ?? u.kind)}
                      {u.source === "email" ? " · from your inbox" : u.source === "agent" ? " · by the agent" : ""} — {u.applications?.jobs?.title ?? ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Hero: shortlist (cream) + agent (pine) */}
      <section className="grid border border-[var(--border)] lg:grid-cols-[minmax(0,1.78fr)_minmax(0,1fr)]">
        <div className="relative overflow-hidden bg-[var(--cream)] p-7 sm:p-12">
          <span className="pointer-events-none absolute -bottom-16 right-4 select-none font-serif text-[220px] leading-none text-[var(--ink)]/[0.05]" aria-hidden>
            9–5
          </span>
          <div className="relative">
            <p className="flex flex-wrap items-center gap-3">
              <span className="border border-[var(--accent)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent-text)]">Your weekly edit</span>
              <span className="kicker">
                {String(newThisWeek).padStart(2, "0")} new role{newThisWeek === 1 ? "" : "s"} worth a look
              </span>
            </p>
            <h2 className="display mt-8 text-[38px] sm:text-[50px]">
              A shortlist with
              <br />
              your name on it.
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
              Roles from verified employers that fit the work you want to do — not just the words on your resume.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <Link href="/jobs" className="inline-flex min-h-[44px] items-center gap-2 bg-[var(--orange)] px-5 text-sm font-semibold text-[#1b120d] hover:brightness-95">
                Explore the shortlist <span aria-hidden>↗</span>
              </Link>
              {savedOn && (
                <Link href="/jobs?show=saved" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold hover:underline">
                  View saved{savedIds.size ? ` (${savedIds.size})` : ""} <span aria-hidden>→</span>
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="relative flex flex-col overflow-hidden bg-[var(--green)] p-7 text-[#eef0e6] sm:p-8">
          <span className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border-[28px] border-white/[0.06]" aria-hidden />
          <p className="kicker !text-[#9fb3a8]">Assisted search / status</p>
          <p className="display mt-4 text-[32px] text-white">{agentState === "paused" ? "Paused. You’re in control." : agentState === "working" ? "Working on it now." : "You’re in control."}</p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#d5ddd6]">
            {agentState === "paused"
              ? "The agent isn’t looking for jobs or applying. Nothing is sent to employers until you resume it."
              : s?.auto_submit_enabled
                ? `It applies to good matches on its own, up to ${s?.daily_apply_cap} a day. Anything it can’t finish comes back to you.`
                : "It finds and checks jobs, but only applies to the ones you queue. Nothing is sent without your say-so."}
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-8">
            <span className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${agentState === "paused" ? "bg-[#e8b660]" : "bg-[#7fcca6]"}`} aria-hidden />
              {agentState === "paused" ? "Assistance paused" : agentState === "working" ? "Running now" : `Next run ~${t.time(nextScheduledRun())}`}
            </span>
            <span className="flex items-center gap-3">
              {dispatchConfigured() && !s?.paused && <RunNowButton running={running} compact />}
              <DeskButton open={{ drawer: "profile", tab: "agent" }} className="min-h-[44px] border-b border-white/60 text-sm text-white hover:border-white">
                Manage rules ↗
              </DeskButton>
            </span>
          </div>
        </div>
      </section>

      {/* Attention + horizon */}
      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1.78fr)_minmax(0,1fr)]">
        <section aria-labelledby="attention">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="attention" className="display text-[30px]">
                Your attention, please.
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">A few things will move your search forward.</p>
            </div>
            <p className="kicker">{String(tasks.length).padStart(2, "0")} items</p>
          </div>
          {tasks.length === 0 ? (
            <p className="mt-4 border-t border-[var(--foreground)] py-6 text-sm text-[var(--muted)]">Nothing needs you right now. Enjoy the quiet — the agent keeps looking.</p>
          ) : (
            <ol className="mt-4 border-t border-[var(--foreground)]">
              {tasks.map((x, i) => (
                <li key={x.title} className="border-b border-[var(--border)]">
                  <Link href={x.href} className="group grid min-h-[72px] grid-cols-[2.5rem_1fr_auto] items-center gap-3 py-3 hover:bg-[var(--hover)]">
                    <span className="pl-2 font-mono text-xs text-[var(--muted)]">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold group-hover:underline">{x.title}</span>
                      <span className="block truncate text-sm text-[var(--muted)]">{x.sub}</span>
                    </span>
                    <span className="flex items-center gap-4 pr-2">
                      <span className="kicker hidden sm:inline">{x.meta}</span>
                      <span className="text-lg" aria-hidden>
                        ↗
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="horizon">
          <h2 id="horizon" className="display text-[30px]">
            On the horizon.
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Conversations in progress and what’s next.</p>
          <ul className="mt-4 border-t border-[var(--foreground)]">
            {horizon.length === 0 && <li className="py-6 text-sm text-[var(--muted)]">Interviews and screening calls will show up here.</li>}
            {horizon.map((h) => (
              <li key={h.title + h.when} className="border-b border-[var(--border)]">
                <Link href={h.href} className="grid grid-cols-[4.5rem_1fr] gap-3 py-4 hover:bg-[var(--hover)]">
                  <span className="font-mono text-sm uppercase">{h.when}</span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{h.title}</span>
                    <span className="block truncate text-sm text-[var(--muted)]">{h.sub}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* This week's shortlist */}
      <section className="mt-16" aria-labelledby="shortlist">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="shortlist" className="display text-[30px]">
              This week’s <Emphasis text="*shortlist*." />
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Verified employers you haven’t applied to, best fit and freshest first.</p>
          </div>
          <Link href="/jobs" className="min-h-[44px] text-sm font-semibold underline underline-offset-4">
            All roles ↗
          </Link>
        </div>
        {top.length === 0 ? (
          <div className="mt-4 border-t border-[var(--foreground)] py-8">
            <p className="text-sm text-[var(--muted)]">
              {parsed ? "No new verified matches right now — the agent looks again on its next run." : "Add your resume and the work you want — your shortlist appears after the next run."}
            </p>
            <Link href={parsed ? "/profile#roles" : "/start"} className="mt-4 inline-flex min-h-[44px] items-center bg-[var(--accent)] px-4 text-sm font-semibold text-white">
              {parsed ? "Adjust what you’re looking for" : "Set up your desk"} ↗
            </Link>
          </div>
        ) : (
          <ul className="mt-4 border-t border-[var(--foreground)]">
            {top.map((j) => (
              <li key={j.id} className="flex items-center gap-4 border-b border-[var(--border)] py-4">
                <Link href={`/jobs?job=${j.id}`} className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                  <span className="min-w-0">
                    <span className="kicker block">{j.company_name}</span>
                    <span className="mt-0.5 block truncate font-semibold hover:underline">{j.title}</span>
                  </span>
                  <span className="text-sm text-[var(--muted)]">
                    {j.job_postings.is_remote ? "Remote" : j.job_postings.locations.slice(0, 1).join("") || "On-site"} · {pay(j.job_postings.salary_min, j.job_postings.salary_max)}
                    {j.job_postings.posted_at ? ` · ${ago(j.job_postings.posted_at, now)}` : ""}
                  </span>
                </Link>
                <FitBadge score={j.fit_score} />
                {savedOn && (
                  <form action={toggleSavedJob.bind(null, j.id, !savedIds.has(j.id))}>
                    <button
                      className={`grid h-10 w-10 place-items-center rounded-sm text-lg hover:bg-[var(--hover)] ${savedIds.has(j.id) ? "text-[var(--orange)]" : "text-[var(--muted)]"}`}
                      aria-pressed={savedIds.has(j.id)}
                      aria-label={savedIds.has(j.id) ? `Remove ${j.title} from saved` : `Save ${j.title}`}
                    >
                      {savedIds.has(j.id) ? "♥" : "♡"}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The week in numbers */}
      <section className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1.78fr)_minmax(0,1fr)]" aria-labelledby="numbers">
        <div>
          <h2 id="numbers" className="display mb-4 text-[30px]">
            The week in numbers.
          </h2>
          <StatStrip
            items={[
              { value: c.total, label: "Tracked applications", href: "/applications?tab=all" },
              { value: c.needs, label: "Need you", href: "/applications?tab=needs", tone: c.needs ? "warning" : undefined },
              { value: c.screening + c.interviews, label: "In conversation", href: "/applications?tab=interview" },
              { value: pct(f.confirmed, f.sent) == null ? "—" : `${pct(f.confirmed, f.sent)}%`, label: "Confirmed received", href: "/applications?tab=sent" },
            ]}
          />
          <p className="mt-3 text-xs text-[var(--muted)]">“Confirmed received” counts only confirmations that reached your connected inbox.</p>
        </div>
        <div>
          <p className="kicker mb-4">Sent per day · {weekTotal} this week</p>
          <div className="flex h-28 items-end gap-2" role="img" aria-label={`Applications sent in the last 7 days: ${days.map((d) => `${d.label} ${d.count}`).join(", ")}`}>
            {days.map((d, i) => (
              <div key={d.key} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="font-mono text-[10px] text-[var(--muted)]">{d.count || ""}</span>
                <div className={`w-full max-w-6 ${i === 6 ? "bg-[var(--orange)]" : "bg-[var(--accent)]/80"}`} style={{ height: `${Math.max(3, (d.count / maxDay) * 80)}px` }} />
                <span className="font-mono text-[10px] uppercase text-[var(--muted)]">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Under the hood: AI and run details, folded away. */}
      <details className="mt-16 border-t border-[var(--border)] pt-5">
        <summary className="cursor-pointer text-sm font-semibold">Under the hood — AI status and recent runs</summary>
        <div className="mt-5 grid gap-8 md:grid-cols-2">
          <div>
            <p className="kicker mb-3 flex justify-between">
              <span>AI status</span>
              <Link href="/usage" className="underline">
                Details
              </Link>
            </p>
            <AiStatus data={ai} when={t.dateTime} />
          </div>
          <div>
            <p className="kicker mb-3 flex justify-between">
              <span>Recent runs</span>
              <Link href="/status" className="underline">
                System status
              </Link>
            </p>
            {!last ? (
              <p className="text-sm text-[var(--muted)]">
                No runs for your account yet. {parsed ? "Your resume is ready, so the next run picks you up" : "Once your resume is read, the next run picks you up"}
                {lastGlobal?.started_at ? ` (last agent run: ${t.dateTime(lastGlobal.started_at)}).` : "."}
              </p>
            ) : (
              <ul className="text-sm">
                {(runs ?? []).map((r, i) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-[var(--border)] py-2">
                    <span className="font-mono text-xs text-[var(--muted)]">{t.dateTime(r.started_at)}</span>
                    <span>{r.status === "completed" ? `${(r.summary as { matched?: number })?.matched ?? 0} matched` : r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
