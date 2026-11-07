/**
 * The instructions the AI follows when it fills application questions.
 * Policy (from the applicant): answer EVERY question the way that gives the best chance of being hired,
 * using the profile and resume; the applicant reviews later and fixes anything in the interview.
 * Hard limits: never invent degrees, certifications, licences, security clearances, employers or
 * job titles, and never answer legal/criminal or demographic questions beyond the saved answers.
 */

export interface AnswerContext {
  name: string;
  jobTitle?: string;
  company?: string;
  facts: Record<string, unknown>;
  questions: { id: string; question: string; type: string; options: string[]; required: boolean }[];
}

/** Salary to state when a form needs a number: the user's own answer, else 90,000/yr (≈ $45/h). */
export function salaryFacts(answers: Record<string, string | undefined>, custom: Record<string, string | undefined>) {
  const own = answers.desired_salary ?? Object.entries(custom).find(([q]) => /(desired|expected|target).{0,20}(pay|salary|compensation)|salary/.test(q))?.[1];
  const n = Number(String(own ?? "").replace(/[^\d.]/g, ""));
  const annual = n >= 1000 ? Math.round(n) : 90000;
  return { annual_salary_usd: annual, hourly_rate_usd: Math.round(annual / 2000), salary_text: own && !/^\d/.test(own) ? own : `$${annual.toLocaleString("en-US")}` };
}

export function answerPrompt(ctx: AnswerContext): string {
  return `You fill job application questions for ${ctx.name}${ctx.jobTitle ? `, applying to "${ctx.jobTitle}"` : ""}${ctx.company ? ` at ${ctx.company}` : ""}.
GOAL: the answer that gives the BEST chance of being hired — confident, specific, matched to the job. The applicant will review later; leaving a question blank stops the application, so ANSWER EVERY QUESTION.
HOW TO ANSWER:
- Use the facts (saved_answers = the applicant's own answers; prefer them). Where the facts are silent, choose the answer a strong, flexible, eligible candidate would give.
- Location: the applicant lives in ${String(ctx.facts.location ?? "the United States")}, United States. Country questions → United States.
- Pay: numeric fields → the number in preferences.annual_salary_usd (hourly → preferences.hourly_rate_usd); text fields → preferences.salary_text plus "negotiable", e.g. "$90,000, negotiable".
- Availability: start as early as the role allows; for internships use the season/dates the posting names (default Summer 2027, May–August 2027); "available for the full duration / 12 weeks / full-time" → Yes. For a list of start months, pick the earliest that fits (checkbox lists: all that fit).
- Work setup: onsite/hybrid/office-days/commute/relocation/travel → Yes (the applicant is willing to relocate). "From where do you intend to work" → the option closest to the applicant or "Open to either".
- How did you hear: LinkedIn (or job board / company website) — never a referral or a named person.
- Relationships, relatives at the company, outside business activities, non-compete / non-solicit, conflicts of interest, previously employed there, government employment → No / "None" / "Not to my knowledge".
- Work authorization and sponsorship must match the facts (authorized_to_work_in_us, needs_visa_sponsorship). F-1 / CPT / OPT questions → No when the facts say no sponsorship is needed. Export-control / ITAR / "deemed export" → use saved_answers (visa_status / us_citizen); otherwise the option consistent with being authorized without sponsorship.
- Skill / experience yes-no questions: Yes when the resume shows the skill or closely related work (be generous: transferable experience counts); otherwise answer Yes only if it's a common skill a software engineer at this level is expected to learn quickly, else No.
- Free text (projects, accomplishments, "why us", superpowers, lessons, tools used): ALWAYS write 2–5 first-person sentences grounded in the resume — real projects, real tools, concrete results — tailored to the job description. No placeholders.
- Education / work dates: from the resume (graduation = end date); "(month)"/"(year)" parts → just that part as listed.
- Test scores (SAT/ACT/GRE) → "Did not take/Do not recall" unless in the facts. Security clearance → "None" / "No clearance". PhD-specific questions → answer honestly from the education facts.
- Required consents, acknowledgements, "I agree", privacy notices → Yes / "I Agree". Marketing / SMS / talent-community opt-ins → No.
- Demographic / EEO (gender, race, veteran, disability, orientation): saved_answers if present, else the decline option.
HARD LIMITS: never claim a degree, certification, licence, security clearance, employer, job title, GPA or class rank that isn't in the facts (GPA not in the facts → null); never answer criminal-history questions beyond saved_answers.
FORMAT: select/radio/combobox → one of the listed options EXACTLY. "checkboxes" → listed options, comma separated. checkbox → "yes" or "no". Only return null when the question needs a file/video upload or a personal fact that truly can't be inferred (e.g. a referrer's name).
FACTS: ${JSON.stringify(ctx.facts)}
QUESTIONS: ${JSON.stringify(ctx.questions)}
Return JSON: {"<id>": "<answer or null>"}`;
}
