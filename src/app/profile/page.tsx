import Link from "next/link";
import { requireUser } from "@/lib/v2/session";
import { saveProfile, updateCustomAnswers } from "../actions";
import type { CustomAnswers } from "@/lib/v2/app-questions";
import { PageHeader, Section, inputCls } from "@/components/ui";
import { CommonQuestions } from "./common-questions";
import { ResumeUpload } from "./resume-upload";
import { SubmitButton } from "@/components/submit-button";
import { suggestTitles } from "@/lib/v2/title-suggestions";
import { ROLE_CATALOG } from "@/lib/v2/role-catalog";

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
  const locs: string[] = p?.locations ?? ["remote_us", "my_state"];
  const parsed = (p?.resume_parsed ?? {}) as { experience?: unknown[]; projects?: unknown[] };
  const roleSet = new Set(((p?.target_roles ?? []) as string[]).map((r) => r.toLowerCase()));
  const haveRole = (r: string) => roleSet.has(r.toLowerCase());
  const suggestions = await suggestTitles(supabase, { have: (p?.target_roles ?? []) as string[], minPay: 60000 }).catch(() => []);

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="You" title="Resume & profile" description="The agent reads your resume to find matching jobs, and uses these answers to fill applications truthfully." />

      <Section
        className="mb-6"
        icon="1"
        title="Main resume"
        description="Upload a PDF. AI reads it once (free tier) and fills the fields below. For each application the agent reorders your real experience so the most relevant parts come first — it never adds anything that isn’t on your resume."
      >
        <ResumeUpload hasResume={Boolean(p?.resume_path)} hasParsed={Boolean(p?.resume_parsed && Object.keys(p.resume_parsed).length)} updatedAt={p?.resume_updated_at ?? null} />
        {p?.resume_path && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Found {parsed.experience?.length ?? 0} jobs and {parsed.projects?.length ?? 0} projects.{" "}
            <Link href="/resumes" className="text-[var(--accent)] hover:underline">
              Keep more resumes and see which one gets responses →
            </Link>
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
            <Field label="City" name="city" value={p?.city} placeholder="Atlanta" />
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

        <div id="roles" className="scroll-mt-6" />
        <Section icon="5" title="What jobs to look for" description="Any field works — tech, healthcare, trades, energy, finance, sales, retail… The agent searches for every role you list and applies to the matches.">
          <div className="space-y-4">
            <label className="block text-sm">
              Your target roles (comma separated, any job title)
              <textarea className={input} name="target_roles" rows={2} defaultValue={(p?.target_roles ?? []).join(", ")} placeholder="Registered Nurse, Medical Assistant — or — Data Analyst, Business Analyst" />
            </label>
            <details className="rounded-xl border border-[var(--border)] p-3 text-sm" open={!(p?.target_roles ?? []).length}>
              <summary className="cursor-pointer font-medium">Browse roles by field — tick a whole field or single titles</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {ROLE_CATALOG.map((g) => (
                  <div key={g.field}>
                    <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
                      <input type="checkbox" name="add_fields" value={g.field} disabled={g.roles.every(haveRole)} defaultChecked={g.roles.every(haveRole)} /> {g.field} — all
                    </label>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
                      {g.roles.map((r) => {
                        const have = haveRole(r);
                        return (
                          <label key={r} className={`flex items-center gap-2 ${have ? "text-[var(--muted)]" : ""}`}>
                            <input type="checkbox" name="add_roles" value={r} disabled={have} defaultChecked={have} /> {r}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </details>
            <label className="block text-sm">
              Focus right now — applied to before anything else, at any US location
              <input className={input} name="focus_roles" defaultValue={((p?.focus_roles ?? []) as string[]).join(", ")} placeholder="Roustabout, Field Operator, oil and gas" />
              <span className="mt-1 block text-xs text-[var(--muted)]">Also set when you tell the chat “go apply to … jobs”. Clear it to go back to normal.</span>
            </label>
            {suggestions.length > 0 && (
              <details className="rounded-xl border border-[var(--border)] p-3 text-sm">
                <summary className="cursor-pointer font-medium">More titles you could apply to — entry level, pay $60K+</summary>
                <span className="mt-1 block text-xs text-[var(--muted)]">Tick any to add them to your target roles. A number means postings like it were seen in the last 2 weeks; “typical” ones are common entry-level roles.</span>
                {(["tech", "field"] as const).map((kind) => {
                  const group = suggestions.filter((s) => s.kind === kind && !haveRole(s.title));
                  if (!group.length) return null;
                  return (
                    <div key={kind} className="mt-2">
                      <div className="text-xs font-medium text-[var(--muted)]">{kind === "tech" ? "Tech & office" : "Field, plant & energy"}</div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                        {group.map((s) => (
                          <label key={s.title} className="flex items-center gap-2">
                            <input type="checkbox" name="add_roles" value={s.title} /> {s.title}
                            <span className="text-xs text-[var(--muted)]">
                              {s.seen ? `${s.seen} seen` : "typical"}
                              {s.payUpTo ? ` · up to $${Math.round(s.payUpTo / 1000)}K` : ""}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </details>
            )}
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
                  ["my_state", `In my state${p?.state ? ` (${p.state})` : " (set State above)"}`],
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
            <Field label="Minimum yearly pay for full-time roles (USD; hourly pay is counted ×2080)" name="min_salary" value={p?.min_salary ?? 40000} type="number" />
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
