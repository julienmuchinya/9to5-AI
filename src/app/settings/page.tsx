import { requireUser } from "@/lib/v2/session";
import { timeFmt } from "@/lib/tz";
import { buttonCls, Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { disconnectInbox, saveAutopilot, saveInbox } from "../actions";
import { GMAIL_OAUTH_HOST, googleOAuthConfigured } from "@/lib/v2/gmail";

export const dynamic = "force-dynamic";

const input = "mt-1.5 w-32 rounded-xl border border-[var(--border)] bg-[var(--background-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ inbox?: string }> }) {
  const { supabase, user } = await requireUser();
  const t = await timeFmt();
  const { inbox: inboxMsg } = await searchParams;
  const google = googleOAuthConfigured();
  const { data: s } = await supabase.from("autopilot_settings").select("*").eq("user_id", user.id).single();
  const { data: p } = await supabase.from("profiles").select("resume_path,work_authorized_us,sponsorship_needed,phone,first_name,last_name,job_email,inbox_email,inbox_host,inbox_last_scan_at,inbox_error").eq("id", user.id).single();
  const missing = [
    !p?.resume_path && "upload your resume",
    (!p?.first_name || !p?.last_name) && "add your first and last name",
    !p?.phone && "add a phone number",
    p?.work_authorized_us == null && "answer the work authorization question",
    p?.sponsorship_needed == null && "answer the sponsorship question",
  ].filter(Boolean) as string[];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Autopilot & inbox" description="Control what the agent does on its own." />
      <form action={saveAutopilot} className="space-y-6">
        <Card>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="auto_submit_enabled" defaultChecked={s?.auto_submit_enabled ?? false} className="mt-1" />
            <span>
              <span className="font-medium">Auto-submit applications</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">
                The agent submits applications for you on Greenhouse, Lever and Ashby job forms — only for{" "}
                <b>verified employers</b>, using only facts from your resume and profile. If a form shows a CAPTCHA or asks something it
                can’t answer truthfully, it hands that job to you under Applications → Needs you.
              </span>
            </span>
          </label>
          {missing.length > 0 && (
            <p className="mt-3 rounded-lg bg-amber-900/30 p-3 text-sm text-amber-300">
              Before auto-submit can work, go to Resume & profile and: {missing.join(", ")}.
            </p>
          )}
        </Card>
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              Max applications per day
              <input className={input} type="number" name="daily_apply_cap" min={0} max={300} defaultValue={s?.daily_apply_cap ?? 5} />
              <span className="mt-1 block text-xs text-[var(--muted)]">0–100 in total. Never more than 10 per company per day, freshest postings first. The free AI quota is the real limit.</span>
            </label>
            <label className="block text-sm">
              Minimum fit score to auto-apply
              <input className={input} type="number" name="min_fit_score" min={40} max={95} defaultValue={s?.min_fit_score ?? 65} />
              <span className="mt-1 block text-xs text-[var(--muted)]">40–95. Higher = pickier.</span>
            </label>
          </div>
        </Card>
        <Card>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="paused" defaultChecked={s?.paused ?? false} className="mt-1" />
            <span>
              <span className="font-medium">Pause my agent</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">Stops job matching and applying for your account until you turn this off.</span>
            </span>
          </label>
        </Card>
        <SubmitButton>Save autopilot settings</SubmitButton>
      </form>

      <Card className="mt-8">
        <span id="inbox" className="block scroll-mt-6" />
        <h2 className="mb-1 font-semibold">Connect your Gmail (free)</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Every run, the agent reads recent emails (read-only) and moves applications to “Under consideration”, “Interview”, “Offer” or
          “Rejected”. While applying it also reads the <b>verification codes</b> sites email you, so it can finish those applications. It never
          sends, deletes or marks mail as read.
        </p>
        {inboxMsg && (
          <p className={`mb-3 rounded-lg p-2 text-sm ${inboxMsg === "ok" ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-300"}`}>
            {inboxMsg === "ok" ? "Connected — the agent can now read your confirmation emails and codes." : inboxMsg}
          </p>
        )}
        {p?.inbox_email && p?.job_email && p.inbox_email.toLowerCase() !== p.job_email.toLowerCase() && (
          <p className="mb-3 rounded-lg bg-amber-900/30 p-2 text-sm text-amber-200">
            Applications use <b>{p.job_email}</b> but the connected inbox is <b>{p.inbox_email}</b> — verification codes go to {p.job_email}, so connect that one.
          </p>
        )}
        {p?.inbox_email && !p.inbox_error ? (
          <div className="space-y-2 text-sm">
            <p>
              Connected{p.inbox_host === GMAIL_OAUTH_HOST ? " with Google" : " with an app password"}: <b>{p.inbox_email}</b>
              {p.inbox_last_scan_at ? ` · last checked ${t.dateTime(p.inbox_last_scan_at)}` : " · first check on the next agent run"}
            </p>
            <form action={disconnectInbox}>
              <button className={buttonCls("secondary", "sm")}>Disconnect inbox</button>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            {p?.inbox_email && p.inbox_error && (
              <p className="rounded-lg bg-red-900/30 p-2 text-sm text-red-300">
                {p.inbox_email} isn’t working: {p.inbox_error}
              </p>
            )}
            {google ? (
              <div>
                <a
                  href="/api/google/connect"
                  className="inline-flex items-center gap-2.5 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 shadow-[var(--shadow)] transition hover:bg-neutral-100"
                >
                  <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                  </svg>
                  Connect with Google
                </a>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Sign in with {p?.job_email ?? "the Gmail you apply with"} and allow “Read your email”. Google may warn that the app isn’t verified —
                  it’s your own app: click <b>Advanced → Go to 9to5 AI</b>. Remove access any time at myaccount.google.com/permissions.
                </p>
              </div>
            ) : (
              <p className="rounded-lg bg-[var(--background-2)] p-2 text-xs text-[var(--muted)]">
                “Connect with Google” appears here once GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are added in Vercel.
              </p>
            )}
            <details className="text-sm" open={!google}>
              <summary className="cursor-pointer text-[var(--muted)]">Or use a Gmail app password instead</summary>
              <form action={saveInbox} className="mt-3 space-y-3">
                <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--muted)]">
                  <li>Turn on 2-Step Verification for your Google account (myaccount.google.com → Security).</li>
                  <li>
                    Open <b>myaccount.google.com/apppasswords</b>, type the name “9to5 AI”, click Create, and copy the 16-letter password.
                  </li>
                  <li>Paste it below — not your normal Gmail password.</li>
                </ol>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    Gmail address
                    <input className={`${input} w-full`} type="email" name="inbox_email" defaultValue={p?.inbox_email ?? p?.job_email ?? user.email ?? ""} required />
                  </label>
                  <label className="block text-sm">
                    App password
                    <input className={`${input} w-full`} type="password" name="inbox_password" autoComplete="off" placeholder="abcd efgh ijkl mnop" required />
                  </label>
                </div>
                <input type="hidden" name="inbox_host" value="imap.gmail.com" />
                <SubmitButton variant="secondary">Connect with app password</SubmitButton>
              </form>
            </details>
          </div>
        )}
      </Card>
    </div>
  );
}
