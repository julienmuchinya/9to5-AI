import { requireUser } from "@/lib/v2/session";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { disconnectInbox, saveAutopilot, saveInbox } from "../actions";

export const dynamic = "force-dynamic";

const input = "mt-1 w-32 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm";

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const { data: s } = await supabase.from("autopilot_settings").select("*").eq("user_id", user.id).single();
  const { data: p } = await supabase.from("profiles").select("resume_path,work_authorized_us,sponsorship_needed,phone,first_name,last_name,inbox_email,inbox_last_scan_at,inbox_error").eq("id", user.id).single();
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
              <input className={input} type="number" name="daily_apply_cap" min={0} max={25} defaultValue={s?.daily_apply_cap ?? 5} />
              <span className="mt-1 block text-xs text-[var(--muted)]">0–25. Fewer, better applications beat spam.</span>
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
        <h2 className="mb-1 font-semibold">Track replies from your inbox (free)</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Every run, the agent reads recent emails (read-only) and moves applications to “Under consideration”, “Interview”, “Offer” or
          “Rejected”. It never sends, deletes or marks mail as read. Uses a Gmail <b>app password</b>, not your real password.
        </p>
        {p?.inbox_email ? (
          <div className="space-y-2 text-sm">
            <p>
              Connected: <b>{p.inbox_email}</b>
              {p.inbox_last_scan_at ? ` · last checked ${new Date(p.inbox_last_scan_at).toLocaleString()}` : " · not checked yet (next agent run)"}
            </p>
            {p.inbox_error && <p className="rounded-lg bg-red-900/30 p-2 text-red-300">{p.inbox_error}</p>}
            <form action={disconnectInbox}>
              <button className="rounded-lg bg-[var(--border)] px-3 py-1.5 text-sm">Disconnect inbox</button>
            </form>
          </div>
        ) : (
          <form action={saveInbox} className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--muted)]">
              <li>Turn on 2-Step Verification for your Google account (myaccount.google.com → Security).</li>
              <li>
                Open <b>myaccount.google.com/apppasswords</b>, type the name “9to5 AI”, click Create, and copy the 16-letter password.
              </li>
              <li>Paste it below. You can revoke it there at any time.</li>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                Gmail address
                <input className={`${input} w-full`} type="email" name="inbox_email" defaultValue={user.email ?? ""} required />
              </label>
              <label className="block text-sm">
                App password
                <input className={`${input} w-full`} type="password" name="inbox_password" autoComplete="off" required />
              </label>
            </div>
            <input type="hidden" name="inbox_host" value="imap.gmail.com" />
            <SubmitButton>Connect inbox</SubmitButton>
          </form>
        )}
      </Card>
    </div>
  );
}
