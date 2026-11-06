import Link from "next/link";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { Badge, Button, Card, PageHeader, StatCard } from "@/components/ui";
import { dispatchConfigured, nextScheduledRun } from "@/lib/v2/dispatch";
import { RunNowButton } from "@/components/run-now";
import { Icon } from "@/components/sidebar";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { supabase, user } = await requireUser();
  const { welcome } = await searchParams;
  const db = serviceClient();
  const [{ data: p }, { data: s }, { count: matched }, { count: verified }, { data: apps }, { data: runs }, { data: sq }, { data: lastGlobal }, { count: recentErrors }] = await Promise.all([
    supabase.from("profiles").select("first_name,resume_path,resume_parsed,phone,work_authorized_us,sponsorship_needed").eq("id", user.id).maybeSingle(),
    supabase.from("autopilot_settings").select("auto_submit_enabled,paused,daily_apply_cap").eq("user_id", user.id).maybeSingle(),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("dismissed", false),
    supabase
      .from("jobs")
      .select("id, job_postings!inner(verification_status)", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("dismissed", false)
      .eq("job_postings.verification_status", "verified"),
    supabase.from("applications").select("status").eq("user_id", user.id),
    supabase.from("agent_runs").select("started_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(5),
    db.from("security_questions").select("user_id").eq("user_id", user.id).maybeSingle(),
    db.from("agent_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("agent_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("level", "error").gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
  ]);
  // Self-heal accounts created before the sign-up trigger existed.
  if (!p || !s) {
    await Promise.all([
      db.from("profiles").upsert({ id: user.id, job_email: user.email }, { onConflict: "id", ignoreDuplicates: true }),
      db.from("autopilot_settings").upsert({ user_id: user.id, auto_apply_enabled: false, mock_mode: false, emergency_stop: false }, { onConflict: "user_id", ignoreDuplicates: true }),
    ]);
  }
  const parsed = Boolean(p?.resume_parsed && Object.keys(p.resume_parsed as object).length);
  const by: Record<string, number> = {};
  for (const a of apps ?? []) by[a.status] = (by[a.status] ?? 0) + 1;

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
        action={<Button href="/chat">Chat with agent</Button>}
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
        <StatCard label="Submitted" value={by.submitted ?? 0} variant="success" icon={<Icon name="applications" />} />
        <StatCard label="Needs you" value={by.needs_user ?? 0} variant={(by.needs_user ?? 0) > 0 ? "warning" : "default"} sub="CAPTCHA or unusual questions" icon={<Icon name="profile" />} />
        <StatCard label="Queued" value={by.queued ?? 0} sub={`Next run ${nextScheduledRun().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`} icon={<Icon name="status" />} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Autopilot</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant={s?.paused ? "danger" : "success"}>{s?.paused ? "Paused" : "Running every 3 hours"}</Badge>
            <Badge variant={s?.auto_submit_enabled ? "success" : "default"}>Auto-submit {s?.auto_submit_enabled ? `on (max ${s?.daily_apply_cap}/day)` : "off"}</Badge>
          </div>
          <p className="mt-3 text-sm text-[var(--muted)]">Applies to the freshest postings first, max 5 per company per day.</p>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            {dispatchConfigured() && <RunNowButton />}
            <Link href="/settings" className="py-1.5 text-sm text-[var(--accent)] hover:underline">
              Change settings
            </Link>
          </div>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Recent runs</h2>
          {!last ? (
            <p className="text-sm text-[var(--muted)]">
              No runs for your account yet.{" "}
              {parsed ? "Your resume is ready, so the next run picks you up" : "Once your resume is read, the next run picks you up"}
              {lastGlobal?.started_at ? ` (last agent run: ${new Date(lastGlobal.started_at).toLocaleString()}; runs about every 3 hours).` : "."}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(runs ?? []).map((r, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-[var(--muted)]">{new Date(r.started_at).toLocaleString()}</span>
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
