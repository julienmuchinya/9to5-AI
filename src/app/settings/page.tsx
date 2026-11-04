import { requireUser } from "@/lib/v2/session";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAutopilot } from "../actions";

export const dynamic = "force-dynamic";

const input = "mt-1 w-32 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm";

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const { data: s } = await supabase.from("autopilot_settings").select("*").eq("user_id", user.id).single();
  const { data: p } = await supabase.from("profiles").select("resume_path,work_authorized_us,sponsorship_needed,phone,first_name,last_name").eq("id", user.id).single();
  const missing = [
    !p?.resume_path && "upload your resume",
    (!p?.first_name || !p?.last_name) && "add your first and last name",
    !p?.phone && "add a phone number",
    p?.work_authorized_us == null && "answer the work authorization question",
    p?.sponsorship_needed == null && "answer the sponsorship question",
  ].filter(Boolean) as string[];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Autopilot" description="Control what the agent does on its own." />
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
    </div>
  );
}
