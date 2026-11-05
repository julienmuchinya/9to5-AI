import Link from "next/link";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { Badge, Card, PageHeader } from "@/components/ui";
import { geminiModels } from "@/lib/v2/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type State = "ok" | "warn" | "fail";
type Check = { name: string; state: State; detail: string; fix?: string; href?: string; ms?: number };

async function time<T>(fn: () => PromiseLike<T> | Promise<T>): Promise<[T | null, number, string | null]> {
  const t0 = Date.now();
  try {
    return [await fn(), Date.now() - t0, null];
  } catch (e) {
    return [null, Date.now() - t0, (e as Error).message];
  }
}

async function geminiCheck(): Promise<Check> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { name: "AI (Gemini)", state: "fail", detail: "GEMINI_API_KEY is not set on the server.", fix: "Add GEMINI_API_KEY in Vercel → Settings → Environment Variables, then redeploy." };
  const [res, ms, err] = await time(() => fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(8000) }));
  if (err || !res) return { name: "AI (Gemini)", state: "warn", detail: `Couldn't reach Google: ${err}`, ms };
  if (res.status === 400 || res.status === 403) return { name: "AI (Gemini)", state: "fail", detail: "Google rejected the API key.", fix: "Create a new key at aistudio.google.com/apikey and update GEMINI_API_KEY in Vercel and GitHub secrets.", ms };
  const data = (await res.json().catch(() => ({}))) as { models?: { name: string }[] };
  const available = new Set((data.models ?? []).map((m) => m.name.replace("models/", "")));
  const usable = geminiModels().filter((m) => available.has(m));
  return usable.length
    ? { name: "AI (Gemini)", state: "ok", detail: `Key works. Will use ${usable[0]} (backups: ${usable.slice(1, 3).join(", ") || "none"}).`, ms }
    : { name: "AI (Gemini)", state: "fail", detail: "None of the app's AI models are available to this key.", fix: "Set GEMINI_MODEL in Vercel to a model listed at ai.google.dev/gemini-api/docs/models.", ms };
}

const AREA_LABEL: Record<string, string> = { resume: "Resume", chat: "Chat", agent: "Agent", inbox: "Inbox", auth: "Sign-in", profile: "Profile", settings: "Settings", jobs: "Jobs", applications: "Applications", vault: "Portal logins", system: "System" };

export default async function StatusPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const { user } = await requireUser();
  const { level } = await searchParams;
  const db = serviceClient();
  const started = Date.now();

  const [[profileRes, dbMs, dbErr], [settingsRes], [sqRes], [runRes], [jobsRes], [needsRes], gemini, [logsRes], [fileRes]] = await Promise.all([
    time(() => db.from("profiles").select("id,resume_path,resume_parsed,phone,city,state,work_authorized_us,sponsorship_needed,inbox_email,inbox_error,inbox_last_scan_at").eq("id", user.id).maybeSingle()),
    time(() => db.from("autopilot_settings").select("auto_submit_enabled,paused,emergency_stop").eq("user_id", user.id).maybeSingle()),
    time(() => db.from("security_questions").select("user_id").eq("user_id", user.id).maybeSingle()),
    time(() => db.from("agent_runs").select("started_at,status,summary").order("started_at", { ascending: false }).limit(1).maybeSingle()),
    time(() => db.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id)),
    time(() => db.from("applications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "needs_user")),
    geminiCheck(),
    time(() => {
      let q = db.from("agent_logs").select("created_at,level,message,metadata").eq("user_id", user.id).order("created_at", { ascending: false }).limit(60);
      if (level === "error") q = q.eq("level", "error");
      if (level === "warn") q = q.in("level", ["warn", "error"]);
      return q;
    }),
    time(() => db.storage.from("resumes").list(user.id)),
  ]);

  const p = profileRes?.data;
  const s = settingsRes?.data;
  const lastRun = runRes?.data as { started_at: string; status: string; summary: Record<string, unknown> | null } | null;
  const hoursSinceRun = lastRun ? (Date.now() - new Date(lastRun.started_at).getTime()) / 3600_000 : null;
  const parsed = Boolean(p?.resume_parsed && Object.keys(p.resume_parsed as object).length);
  const hasFile = Boolean(fileRes?.data?.some((f) => f.name === "resume.pdf"));
  const missingProfile = [!p?.phone && "phone", !(p?.city && p?.state) && "city/state", p?.work_authorized_us == null && "work authorization", p?.sponsorship_needed == null && "sponsorship"].filter(Boolean) as string[];

  const checks: Check[] = [
    dbErr || profileRes?.error
      ? { name: "Database (Supabase)", state: "fail", detail: dbErr ?? profileRes?.error?.message ?? "error", fix: "Check the Supabase project isn't paused (free projects pause after 7 days of no use) at supabase.com/dashboard.", ms: dbMs }
      : { name: "Database (Supabase)", state: dbMs > 1500 ? "warn" : "ok", detail: dbMs > 1500 ? `Slow: ${dbMs} ms per query.` : `Connected (${dbMs} ms).`, ms: dbMs },
    gemini,
    !p
      ? { name: "Your profile record", state: "fail", detail: "Missing — saves would be lost.", fix: "Open Resume & profile and click Save profile; it will be created." , href: "/profile" }
      : { name: "Your profile record", state: "ok", detail: "Exists." },
    !s
      ? { name: "Autopilot settings record", state: "fail", detail: "Missing — the agent skips your account.", fix: "Open Autopilot & inbox and click Save.", href: "/settings" }
      : s.paused
        ? { name: "Autopilot settings record", state: "warn", detail: "Your agent is paused.", fix: "Untick “Pause my agent” on Autopilot & inbox.", href: "/settings" }
        : { name: "Autopilot settings record", state: "ok", detail: `Auto-submit ${s.auto_submit_enabled ? "on" : "off"}.` },
    !hasFile
      ? { name: "Resume", state: "fail", detail: "No resume uploaded — the agent can't match jobs.", fix: "Upload a PDF on Resume & profile.", href: "/profile" }
      : !parsed
        ? { name: "Resume", state: "fail", detail: "PDF is saved but hasn't been read by the AI.", fix: "Click “Read it again” on Resume & profile.", href: "/profile" }
        : { name: "Resume", state: "ok", detail: "Uploaded and read." },
    missingProfile.length
      ? { name: "Application details", state: "warn", detail: `Missing: ${missingProfile.join(", ")}. Forms needing these go to “Needs you”.`, fix: "Fill them in on Resume & profile.", href: "/profile" }
      : { name: "Application details", state: "ok", detail: "Phone, location and work eligibility are set." },
    sqRes?.data
      ? { name: "Password recovery", state: "ok", detail: "Security questions set." }
      : { name: "Password recovery", state: "warn", detail: "No security questions — you can only reset by email code.", fix: "Set them on Account & security.", href: "/account" },
    !lastRun
      ? { name: "Agent (GitHub Actions)", state: "warn", detail: "No agent run has been recorded yet.", fix: "It runs every ~3 hours. Check github.com → your repo → Actions." }
      : lastRun.status === "failed"
        ? { name: "Agent (GitHub Actions)", state: "fail", detail: `Last run failed ${Math.round(hoursSinceRun!)} h ago: ${String(lastRun.summary?.error ?? "unknown error").slice(0, 200)}`, fix: "Open the run in GitHub → Actions to see the full log." }
        : hoursSinceRun! > 9
          ? { name: "Agent (GitHub Actions)", state: "warn", detail: `Last run was ${Math.round(hoursSinceRun!)} h ago — longer than expected.`, fix: "GitHub can delay or disable schedules on quiet repos. Open Actions and click “Enable workflow” / “Run workflow”." }
          : { name: "Agent (GitHub Actions)", state: "ok", detail: `Last run ${hoursSinceRun! < 1 ? "under an hour" : `${Math.round(hoursSinceRun!)} h`} ago (${lastRun.status}).` },
    { name: "Matched jobs", state: (jobsRes?.count ?? 0) > 0 ? "ok" : "warn", detail: `${jobsRes?.count ?? 0} jobs matched to you.${(jobsRes?.count ?? 0) === 0 ? " Matching starts on the first agent run after your resume is read." : ""}` },
    { name: "Needs you", state: (needsRes?.count ?? 0) > 0 ? "warn" : "ok", detail: `${needsRes?.count ?? 0} applications waiting for you to finish.`, href: (needsRes?.count ?? 0) > 0 ? "/applications?tab=needs" : undefined },
    !p?.inbox_email
      ? { name: "Inbox tracking", state: "warn", detail: "Not connected — application statuses won't update from email.", fix: "Optional: connect a Gmail app password on Autopilot & inbox.", href: "/settings" }
      : p.inbox_error
        ? { name: "Inbox tracking", state: "fail", detail: p.inbox_error, fix: "Create a new Gmail app password and reconnect.", href: "/settings" }
        : { name: "Inbox tracking", state: "ok", detail: p.inbox_last_scan_at ? `Last checked ${new Date(p.inbox_last_scan_at).toLocaleString()}.` : "Connected; checked on the next agent run." },
    process.env.GH_DISPATCH_TOKEN
      ? { name: "“Run now” from chat", state: "ok", detail: "Enabled." }
      : { name: "“Run now” from chat", state: "warn", detail: "Off — the agent only runs on its schedule.", fix: "Optional: add a GitHub token with Actions write access as GH_DISPATCH_TOKEN in Vercel." },
    process.env.VAULT_KEY ? { name: "Password vault key", state: "ok", detail: "Set." } : { name: "Password vault key", state: "warn", detail: "VAULT_KEY not set in Vercel — using a fallback key.", fix: "Add VAULT_KEY (same value as GitHub secret) in Vercel → Environment Variables." },
  ];

  const order: Record<State, number> = { fail: 0, warn: 1, ok: 2 };
  checks.sort((a, b) => order[a.state] - order[b.state]);
  const fails = checks.filter((c) => c.state === "fail").length;
  const warns = checks.filter((c) => c.state === "warn").length;
  const logs = (logsRes?.data ?? []) as { created_at: string; level: string; message: string; metadata: { area?: string } | null }[];
  const variant = (st: string) => (st === "error" || st === "fail" ? "danger" : st === "warn" ? "warning" : "success") as "danger" | "warning" | "success";

  return (
    <div className="max-w-4xl">
      <PageHeader title="System status" description="What’s working, what isn’t, and how to fix it. Checked live each time you open this page." />
      <Card className="mb-6">
        <p className="text-sm">
          {fails === 0 && warns === 0 ? "✅ Everything is working." : `${fails ? `❌ ${fails} problem${fails > 1 ? "s" : ""}` : ""}${fails && warns ? " · " : ""}${warns ? `⚠️ ${warns} thing${warns > 1 ? "s" : ""} to look at` : ""}`}
          <span className="text-[var(--muted)]"> · checked in {Date.now() - started} ms</span>
        </p>
      </Card>

      <div className="mb-8 space-y-2">
        {checks.map((c) => (
          <Card key={c.name} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-[var(--muted)]">{c.detail}</p>
                {c.fix && c.state !== "ok" && <p className="mt-1 text-sm">How to fix: {c.fix}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {c.ms != null && <span className="text-xs text-[var(--muted)]">{c.ms} ms</span>}
                <Badge variant={variant(c.state)}>{c.state === "ok" ? "OK" : c.state === "warn" ? "Check" : "Problem"}</Badge>
                {c.href && c.state !== "ok" && (
                  <Link href={c.href} className="rounded-lg bg-[var(--border)] px-2 py-1 text-xs">
                    Fix
                  </Link>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Activity & error log</h2>
        <div className="flex gap-2 text-sm">
          {[
            [undefined, "All"],
            ["warn", "Warnings + errors"],
            ["error", "Errors only"],
          ].map(([v, label]) => (
            <a key={label} href={v ? `?level=${v}` : "?"} className={`rounded-lg px-3 py-1 ${level === v ? "bg-[var(--accent)] text-white" : "bg-[var(--border)]"}`}>
              {label}
            </a>
          ))}
        </div>
      </div>
      <Card className="p-0">
        {logs.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">Nothing logged yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {logs.map((l, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2 px-4 py-2 text-sm">
                <span className="w-36 shrink-0 text-xs text-[var(--muted)]">{new Date(l.created_at).toLocaleString()}</span>
                <Badge variant={variant(l.level)}>{AREA_LABEL[l.metadata?.area ?? ""] ?? "Agent"}</Badge>
                <span className="min-w-0 flex-1 break-words">{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-[var(--muted)]">Logs older than 30 days are deleted automatically to stay on the free tier.</p>
    </div>
  );
}
