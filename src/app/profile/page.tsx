import { requireUser } from "@/lib/v2/session";
import { saveProfile, updateCustomAnswers } from "../actions";
import type { CustomAnswers } from "@/lib/v2/app-questions";
import { PageHeader, Section, inputCls } from "@/components/ui";
import { CommonQuestions } from "./common-questions";
import { ResumeUpload } from "./resume-upload";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

const input = inputCls;

function Field({ label, name, value, placeholder, type = "text" }: { label: string; name: string; value?: string | number | null; placeholder?: string; type?: string }) {
  return (
    <label className="block text-sm">
      {label}
      <input className={input} name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} />
    </label>
  );
}

function YesNo({ label, name, value }: { label: string; name: string; value: boolean | null }) {
  return (
    <label className="block text-sm">
      {label}
      <select className={input} name={name} defaultValue={value == null ? "" : value ? "yes" : "no"}>
        <option value="">Not set — the agent will ask you</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

export default async function ProfilePage() {
  const { supabase, user } = await requireUser();
  const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  const levels: string[] = p?.job_levels ?? ["internship", "new_grad", "entry"];
  const locs: string[] = p?.locations ?? ["remote_us", "GA"];
  const parsed = (p?.resume_parsed ?? {}) as { experience?: unknown[]; projects?: unknown[] };

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="You" title="Resume & profile" description="The agent reads your resume to find matching jobs, and uses these answers to fill applications truthfully." />

      <Section
        className="mb-6"
        icon="1"
        title="Your resume"
        description="Upload a PDF. AI reads it once (free tier) and fills the fields below. For each application the agent reorders your real experience so the most relevant parts come first — it never adds anything that isn’t on your resume."
      >
        <ResumeUpload hasResume={Boolean(p?.resume_path)} hasParsed={Boolean(p?.resume_parsed && Object.keys(p.resume_parsed).length)} updatedAt={p?.resume_updated_at ?? null} />
        {p?.resume_path && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Found {parsed.experience?.length ?? 0} jobs and {parsed.projects?.length ?? 0} projects.
          </p>
        )}
      </Section>

      <form action={saveProfile} className="space-y-6">
        <Section icon="2" title="Contact details" description="Used on every application.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="first_name" value={p?.first_name} />
            <Field label="Last name" name="last_name" value={p?.last_name} />
            <Field label="Email for applications" name="job_email" value={p?.job_email ?? user.email} type="email" />
            <Field label="Phone" name="phone" value={p?.phone} />
            <Field label="City" name="city" value={p?.city} placeholder="Kennesaw" />
            <Field label="State" name="state" value={p?.state} placeholder="GA" />
            <Field label="LinkedIn URL" name="linkedin_url" value={p?.linkedin_url} />
            <Field label="GitHub URL" name="github_url" value={p?.github_url} />
            <Field label="Portfolio / website" name="website_url" value={p?.website_url} />
            <Field label="School" name="school" value={p?.school} />
            <Field label="Graduation (e.g. May 2027)" name="graduation_date" value={p?.graduation_date} />
          </div>
        </Section>

        <Section icon="3" title="Work eligibility" description="Applications always ask these. Until you answer, the agent sends those jobs to you instead of guessing.">
          <div className="grid gap-4 sm:grid-cols-2">
            <YesNo label="Authorized to work in the US?" name="work_authorized_us" value={p?.work_authorized_us ?? null} />
            <YesNo label="Will you need visa sponsorship?" name="sponsorship_needed" value={p?.sponsorship_needed ?? null} />
          </div>
        </Section>

        <div id="common-questions" className="scroll-mt-6">
          <Section icon="4" title="Common application questions" description="Answer once — the agent fills these on every form without spending AI calls.">
            <CommonQuestions answers={(p?.application_answers ?? {}) as Record<string, string>} />
          </Section>
        </div>

        <Section icon="5" title="What jobs to look for">
          <div className="space-y-4">
            <div className="text-sm">
              Levels
              <div className="mt-2 flex flex-wrap gap-4">
                {[
                  ["internship", "Internships"],
                  ["new_grad", "New grad"],
                  ["entry", "Entry level"],
                  ["mid", "Mid level"],
                  ["senior", "Senior"],
                ].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input type="checkbox" name="job_levels" value={v} defaultChecked={levels.includes(v)} /> {l}
                  </label>
                ))}
              </div>
            </div>
            <div className="text-sm">
              Locations
              <div className="mt-2 flex flex-wrap gap-4">
                {[
                  ["remote_us", "Remote (US)"],
                  ["GA", "Georgia / Atlanta"],
                  ["anywhere_us", "Anywhere in the US"],
                ].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input type="checkbox" name="locations" value={v} defaultChecked={locs.includes(v)} /> {l}
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="relocation" defaultChecked={p?.relocation ?? true} /> Open to relocating for internships/new grad
                </label>
              </div>
            </div>
            <Field label="Minimum yearly pay for full-time roles (USD)" name="min_salary" value={p?.min_salary ?? 80000} type="number" />
            <Field label="Target roles (comma separated)" name="target_roles" value={(p?.target_roles ?? []).join(", ")} placeholder="Software Engineer, Data Engineer" />
            <label className="block text-sm">
              Skills (comma separated — from your resume, edit freely)
              <textarea className={input} name="skills" rows={3} defaultValue={(p?.skills ?? []).join(", ")} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Prefer jobs mentioning" name="keywords_include" value={(p?.keywords_include ?? []).join(", ")} placeholder="Python, AWS" />
              <Field label="Skip jobs mentioning" name="keywords_exclude" value={(p?.keywords_exclude ?? []).join(", ")} placeholder="clearance, PHP" />
            </div>
            <Field label="Never apply to these companies" name="excluded_companies" value={(p?.excluded_companies ?? []).join(", ")} />
          </div>
        </Section>

        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 p-3 shadow-[var(--shadow)] backdrop-blur">
          <p className="text-sm text-[var(--muted)]">Changes apply on the next agent run.</p>
          <SubmitButton>Save profile</SubmitButton>
        </div>
      </form>

      {Object.keys((p?.custom_answers ?? {}) as CustomAnswers).length > 0 && (
        <form action={updateCustomAnswers} className="mt-6" id="other-answers">
          <Section icon="6" title="Your answers to other questions" description="Questions you answered for the agent on the Applications page. It reuses them on the same or similar questions. Clear a box to delete that answer.">
            <div className="space-y-3">
              {Object.entries((p?.custom_answers ?? {}) as CustomAnswers)
                .sort((a, b) => (b[1].at ?? "").localeCompare(a[1].at ?? ""))
                .map(([key, v]) => (
                  <label key={key} className="block text-sm">
                    {v.q}
                    {v.a.length > 80 ? (
                      <textarea className={input} name={`ca_${key}`} rows={3} defaultValue={v.a} />
                    ) : (
                      <input className={input} name={`ca_${key}`} defaultValue={v.a} />
                    )}
                  </label>
                ))}
            </div>
            <div className="mt-4">
              <SubmitButton variant="secondary">Save these answers</SubmitButton>
            </div>
          </Section>
        </form>
      )}
    </div>
  );
}
