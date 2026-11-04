import Link from "next/link";
import { requireUser } from "@/lib/v2/session";
import { hasSecurityQuestions } from "../auth-actions";
import { Badge, Button, Card, PageHeader, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { supabase, user } = await requireUser();
  const [{ data: p }, { data: s }, { count: matched }, { count: verified }, { data: apps }, { data: runs }] = await Promise.all([
    supabase.from("profiles").select("first_name,resume_path,phone,work_authorized_us,sponsorship_needed").eq("id", user.id).single(),
    supabase.from("autopilot_settings").select("auto_submit_enabled,paused,daily_apply_cap").eq("user_id", user.id).single(),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("dismissed", false),
    supabase
      .from("jobs")
      .select("id, job_postings!inner(verification_status)", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("dismissed", false)
      .eq("job_postings.verification_status", "verified"),
    supabase.from("applications").select("status").eq("user_id", user.id),
    supabase.from("agent_runs").select("started_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(5),
  ]);
  const by: Record<string, number> = {};
  for (const a of apps ?? []) by[a.status] = (by[a.status] ?? 0) + 1;

  const hasQ = await hasSecurityQuestions();
  const steps = [
    { done: hasQ, label: "Set 3 security questions (password recovery)", href: "/account" },
    { done: Boolean(p?.resume_path), label: "Upload your resume", href: "/profile" },
    { done: Boolean(p?.first_name && p?.phone), label: "Add your contact details", href: "/profile" },
    { done: p?.work_authorized_us != null && p?.sponsorship_needed != null, label: "Answer work authorization & sponsorship", href: "/profile" },
    { done: Boolean(s?.auto_submit_enabled), label: "Turn on auto-submit (optional)", href: "/settings" },
  ];
  const last = runs?.[0];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Welcome${p?.first_name ? `, ${p.first_name}` : ""}`}
        description="Your agent finds STEM jobs that fit your resume, checks the employer is real, and applies for you."
        action={<Button href="/chat">Chat with agent</Button>}
      />

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
        <StatCard label="Matched jobs" value={matched ?? 0} sub={`${verified ?? 0} verified employers`} />
        <StatCard label="Submitted" value={by.submitted ?? 0} variant="success" />
        <StatCard label="Needs you" value={by.needs_user ?? 0} variant={(by.needs_user ?? 0) > 0 ? "warning" : "default"} sub="CAPTCHA or unusual questions" />
        <StatCard label="Queued" value={by.queued ?? 0} sub="Next run" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Autopilot</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant={s?.paused ? "danger" : "success"}>{s?.paused ? "Paused" : "Running every 3 hours"}</Badge>
            <Badge variant={s?.auto_submit_enabled ? "success" : "default"}>Auto-submit {s?.auto_submit_enabled ? `on (max ${s?.daily_apply_cap}/day)` : "off"}</Badge>
          </div>
          <Link href="/settings" className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline">
            Change settings
          </Link>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Recent runs</h2>
          {!last ? (
            <p className="text-sm text-[var(--muted)]">No runs yet for your account. After you upload your resume, the next run picks you up.</p>
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
