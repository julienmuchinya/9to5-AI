import Link from "next/link";
import { timeFmt } from "@/lib/tz";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { Badge, Button, Card, PageHeader, StatCard } from "@/components/ui";
import { dispatchConfigured, nextScheduledRun } from "@/lib/v2/dispatch";
import { RunNowButton } from "@/components/run-now";
import { Icon } from "@/components/sidebar";
import { countPipeline, statusRows } from "@/lib/v2/pipeline";
import { aiStatus } from "@/lib/v2/ai-status";
import { AiStatus } from "@/components/ai-status";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { supabase, user } = await requireUser();
  const t = await timeFmt();
  const { welcome } = await searchParams;
  const db = serviceClient();
  const [{ data: p }, { data: s }, { count: matched }, { count: verified }, apps, { data: runs }, { data: sq }, { data: lastGlobal }, { count: recentErrors }, ai] = await Promise.all([
    supabase.from("profiles").select("first_name,resume_path,resume_parsed,phone,work_authorized_us,sponsorship_needed").eq("id", user.id).maybeSingle(),
    supabase.from("autopilot_settings").select("auto_submit_enabled,paused,daily_apply_cap").eq("user_id", user.id).maybeSingle(),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("dismissed", false),
    supabase
      .from("jobs")
      .select("id, job_postings!inner(verification_status)", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("dismissed", false)
      .eq("job_postings.verification_status", "verified"),
    statusRows(supabase, user.id),
    supabase.from("agent_runs").select("started_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(5),
    db.from("security_questions").select("user_id").eq("user_id", user.id).maybeSingle(),
    db.from("agent_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("agent_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("level", "error").gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
    aiStatus(db),
  ]);
  // Self-heal accounts created before the sign-up trigger existed.
  if (!p || !s) {
    await Promise.all([
      db.from("profiles").upsert({ id: user.id, job_email: user.email }, { onConflict: "id", ignoreDuplicates: true }),
      db.from("autopilot_settings").upsert({ user_id: user.id, auto_apply_enabled: false, mock_mode: false, emergency_stop: false }, { onConflict: "user_id", ignoreDuplicates: true }),
    ]);
  }
  const parsed = Boolean(p?.resume_parsed && Object.keys(p.resume_parsed as object).length);
  // Same counting as the Applications page (one shared definition).
  const c = countPipeline(apps);

  const hasQ = Boolean(sq);
  const steps = [
    { done: hasQ, label: "Set 3 security questions (password recovery)", href: "/account" },
    { done: Boolean(p?.resume_path) && parsed, label: p?.resume_path && !parsed ? "Your resume is saved but not read yet — click “Read it again”" : "Upload your resume", href: "/profile" },
    { done: Boolean(p?.first_name && p?.phone), label: "Add your contact details", href: "/profile" },
    { done: p?.work_authorized_us != null && p?.sponsorship_needed != null, label: "Answer work authorization & sponsorship", href: "/profile" },
    { done: Boolean(s?.auto_submit_enabled), label: "Turn on auto-submit (optional)", href: "/settings" },
  ];
  const last = runs?.[0];

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome${p?.first_name ? `, ${p.first_name}` : ""}`}
        description="Your agent finds STEM jobs that fit your resume, checks the employer is real, and applies for you."
        action={
          <div className="flex items-center gap-3">
            <Button href="/chat" variant="secondary">
              Chat with agent
            </Button>
            {dispatchConfigured() && <RunNowButton running={last?.status === "running"} details />}
          </div>
        }
      />

      {(recentErrors ?? 0) > 0 && (
        <Link href="/status?level=error" className="mb-6 block rounded-lg bg-red-900/30 p-3 text-sm text-red-300 hover:underline">
          {recentErrors} error{recentErrors === 1 ? "" : "s"} in the last 24 hours — open System status to see what failed and how to fix it.
        </Link>
      )}
      {welcome && (
        <p className="mb-6 rounded-lg bg-emerald-900/30 p-3 text-sm text-emerald-300">Your email is confirmed and you’re signed in. Follow the steps below to get your agent working.</p>
      )}

      {steps.some((x) => !x.done) && (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold">Get started</h2>
          <ol className="space-y-2 text-sm">
            {steps.map((x, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={x.done ? "text-emerald-400" : "text-[var(--muted)]"}>{x.done ? "✓" : `${i + 1}.`}</span>
                {x.done ? <span className="text-[var(--muted)] line-through">{x.label}</span> : <Link href={x.href} className="text-[var(--accent)] hover:underline">{x.label}</Link>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Matched jobs" value={matched ?? 0} sub={`${verified ?? 0} verified employers`} icon={<Icon name="jobs" />} />
        <Link href="/applications?tab=sent" className="block rounded-2xl transition hover:opacity-90">
          <StatCard label="Sent" value={c.sent} variant="success" sub={`${c.inReview} in review · ${c.interviews} interviews`} icon={<Icon name="applications" />} />
        </Link>
        <Link href="/applications?tab=needs" className="block rounded-2xl transition hover:opacity-90">
          <StatCard label="Needs you" value={c.needs} variant={c.needs > 0 ? "warning" : "default"} sub="Questions, sign-ins, CAPTCHAs" icon={<Icon name="profile" />} />
        </Link>
        <Link href="/applications?tab=queued" className="block rounded-2xl transition hover:opacity-90">
        <StatCard label="Queued" value={c.queued} sub={`Next run ~${t.time(nextScheduledRun())}`} icon={<Icon name="status" />} />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col">
          <h2 className="mb-3 font-semibold">Autopilot</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant={s?.paused ? "danger" : "success"}>{s?.paused ? "Paused" : "Runs every 3 hours"}</Badge>
            <Badge variant={s?.auto_submit_enabled ? "success" : "default"}>Auto-submit {s?.auto_submit_enabled ? `on · max ${s?.daily_apply_cap}/day` : "off"}</Badge>
          </div>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Freshest postings first, max 5 per company per day. Next scheduled run{" "}
            ~{t.time(nextScheduledRun(), true)} (GitHub may start it late).
          </p>
          <div className="mt-auto pt-4">
            <Button href="/settings" variant="secondary" size="sm">
              Autopilot settings
            </Button>
          </div>
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">AI status</h2>
            <Link href="/usage" className="text-xs text-[var(--accent)] hover:underline">
              Details
            </Link>
          </div>
          <AiStatus data={ai} />
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Recent runs</h2>
          {!last ? (
            <p className="text-sm text-[var(--muted)]">
              No runs for your account yet.{" "}
              {parsed ? "Your resume is ready, so the next run picks you up" : "Once your resume is read, the next run picks you up"}
              {lastGlobal?.started_at ? ` (last agent run: ${t.dateTime(lastGlobal.started_at)}; runs about every 3 hours).` : "."}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(runs ?? []).map((r, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-[var(--muted)]">{t.dateTime(r.started_at)}</span>
                  <span>
                    {r.status === "completed" ? `${(r.summary as { matched?: number })?.matched ?? 0} matched` : r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
