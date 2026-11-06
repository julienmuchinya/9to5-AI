/**
 * Questions almost every job application asks. The user answers them once on their profile;
 * the agent then fills matching form fields without calling the AI (free and truthful).
 * Shared with the browser — no secrets here.
 */

export interface AppQuestion {
  key: string;
  label: string;
  group: "Eligibility" | "Availability & pay" | "Background" | "Voluntary self-identification";
  /** Fixed choices; omit for free text. */
  options?: string[];
  placeholder?: string;
  help?: string;
  /** Matches the label text of a form field (lower-cased). */
  match: RegExp;
  /** Skip this question when the label also matches this. */
  not?: RegExp;
}

const DECLINE = "Decline to self-identify";

export const APP_QUESTIONS: AppQuestion[] = [
  // ── Eligibility ─────────────────────────────────────────────────────────
  {
    key: "over_18",
    label: "Are you 18 or older?",
    group: "Eligibility",
    options: ["Yes", "No"],
    match: /(18 years|over 18|at least 18|age of 18|legal age)/,
  },
  {
    key: "us_citizen",
    label: "Are you a US citizen?",
    group: "Eligibility",
    options: ["Yes", "No"],
    match: /(u\.?s\.? citizen|citizen of the united states|united states citizen|citizenship status)/,
    not: /export|itar|sponsor/,
  },
  {
    key: "visa_status",
    label: "Current visa / work status",
    group: "Eligibility",
    options: ["US Citizen", "Green Card / Permanent Resident", "F-1 OPT", "F-1 CPT", "STEM OPT", "H-1B", "TN", "Other"],
    match: /(visa (status|type)|immigration status|current work (status|authorization)|type of (work )?authorization)/,
  },
  {
    key: "future_sponsorship",
    label: "Will you need sponsorship in the future (e.g. after OPT)?",
    group: "Eligibility",
    options: ["Yes", "No"],
    match: /(future|now or in the future|will you (now or )?(in the future )?require).*(sponsor)/,
  },
  {
    key: "export_control",
    label: "Can you access export-controlled (ITAR/EAR) work? (usually: US citizen or green card)",
    group: "Eligibility",
    options: ["Yes", "No"],
    match: /(\bitar\b|export control|\bear\b|u\.?s\.? person)/,
  },
  {
    key: "security_clearance",
    label: "Security clearance",
    group: "Eligibility",
    options: ["None", "Eligible / willing to obtain", "Secret", "Top Secret", "TS/SCI"],
    match: /(security clearance|active clearance|clearance level|hold a clearance)/,
  },
  {
    key: "background_check",
    label: "Willing to complete a background check / drug screen?",
    group: "Eligibility",
    options: ["Yes", "No"],
    match: /(background (check|screen)|drug (test|screen))/,
  },
  // ── Availability & pay ──────────────────────────────────────────────────
  {
    key: "start_date",
    label: "Earliest start date",
    group: "Availability & pay",
    placeholder: "e.g. May 2027, or Immediately",
    match: /(start date|available to start|when can you start|earliest (start|availability)|availability date)/,
  },
  {
    key: "notice_period",
    label: "Notice period",
    group: "Availability & pay",
    options: ["Immediately", "1 week", "2 weeks", "1 month", "More than 1 month"],
    match: /(notice period|how much notice)/,
  },
  {
    key: "desired_salary",
    label: "Desired pay (yearly or hourly)",
    group: "Availability & pay",
    placeholder: "e.g. $90,000 or $35/hour, or Negotiable",
    match: /(desired (salary|pay|compensation)|salary (expectation|requirement)|expected (salary|compensation)|compensation expectation|pay expectation)/,
  },
  {
    key: "work_mode",
    label: "Open to which work setups?",
    group: "Availability & pay",
    options: ["Remote, hybrid or onsite", "Remote or hybrid", "Remote only", "Onsite or hybrid"],
    match: /(onsite|on-site|in office|in-office|hybrid|return to office|work from (the )?office|days (a|per) week in)/,
  },
  {
    key: "willing_to_relocate",
    label: "Willing to relocate?",
    group: "Availability & pay",
    options: ["Yes", "No"],
    match: /(relocat)/,
  },
  {
    key: "willing_to_travel",
    label: "Willing to travel for work?",
    group: "Availability & pay",
    options: ["Yes", "Up to 25%", "Up to 50%", "No"],
    match: /(willing to travel|travel requirement|able to travel|percent(age)? travel)/,
  },
  // ── Background ──────────────────────────────────────────────────────────
  {
    key: "highest_degree",
    label: "Highest degree (completed or in progress)",
    group: "Background",
    options: ["High school", "Associate", "Bachelor's (in progress)", "Bachelor's", "Master's (in progress)", "Master's", "PhD"],
    match: /(highest (level of )?(education|degree)|degree (level|type)|level of education)/,
  },
  { key: "major", label: "Major / field of study", group: "Background", placeholder: "e.g. Computer Science", match: /(major|field of study|area of study|discipline)/ },
  { key: "gpa", label: "GPA", group: "Background", placeholder: "e.g. 3.6", match: /\bgpa\b|grade point/ },
  {
    key: "years_experience",
    label: "Years of professional experience",
    group: "Background",
    options: ["0", "Less than 1", "1-2", "3-5", "5+"],
    match: /(years of (professional |relevant |work )?experience|how many years)/,
  },
  { key: "languages", label: "Languages you speak", group: "Background", placeholder: "e.g. English, French, Swahili", match: /(languages? (do you )?speak|spoken languages|language proficiency)/ },
  {
    key: "how_heard",
    label: "How did you hear about jobs? (default answer)",
    group: "Background",
    options: ["Company website", "LinkedIn", "Job board", "University / career fair", "Referral", "Other"],
    match: /(how did you (hear|learn|find)|where did you (hear|find|learn)|source of (application|referral)|how were you referred)/,
  },
  {
    key: "previously_employed",
    label: "Have you worked for these companies before? (default answer)",
    group: "Background",
    options: ["No", "Yes"],
    match: /(previously (been )?(employed|worked)|ever (been )?(employed|worked) (by|for|at)|former employee|worked (here|for us) before)/,
  },
  {
    key: "referred",
    label: "Were you referred by an employee? (default answer)",
    group: "Background",
    options: ["No", "Yes"],
    match: /(referred by|employee referral|were you referred|know anyone (who works|at)|know (anyone|someone).{0,60}(employ|work(s|ed)? (at|for|here)))/,
  },
  { key: "pronouns", label: "Pronouns (optional)", group: "Background", placeholder: "e.g. he/him", match: /pronoun/ },
  { key: "address", label: "Street address (only if a form requires it)", group: "Background", placeholder: "123 Main St", match: /(street address|address line 1|mailing address|^address\b)/, not: /e-?mail/ },
  { key: "zip", label: "ZIP code", group: "Background", placeholder: "30301", match: /(zip|postal) ?code/ },
  { key: "country", label: "Country", group: "Background", placeholder: "United States", match: /^(country|country of residence)\b/ },
  // ── Voluntary self-identification (EEO) ────────────────────────────────
  {
    key: "gender",
    label: "Gender",
    group: "Voluntary self-identification",
    options: ["Male", "Female", "Non-binary", DECLINE],
    match: /\b(gender|sex)\b/,
    not: /orientation|transgender/,
  },
  {
    key: "hispanic_latino",
    label: "Are you Hispanic or Latino?",
    group: "Voluntary self-identification",
    options: ["Yes", "No", DECLINE],
    match: /(hispanic|latino|latinx)/,
    not: /\brace\b.*(white|black|asian)/,
  },
  {
    key: "race",
    label: "Race / ethnicity",
    group: "Voluntary self-identification",
    options: [
      "Black or African American",
      "White",
      "Asian",
      "Hispanic or Latino",
      "American Indian or Alaska Native",
      "Native Hawaiian or Other Pacific Islander",
      "Two or more races",
      DECLINE,
    ],
    match: /\b(race|ethnicity|racial)\b/,
  },
  {
    key: "veteran",
    label: "Veteran status",
    group: "Voluntary self-identification",
    options: ["I am not a protected veteran", "I am a protected veteran", DECLINE],
    match: /veteran/,
  },
  {
    key: "disability",
    label: "Disability status",
    group: "Voluntary self-identification",
    options: ["No, I do not have a disability", "Yes, I have a disability", DECLINE],
    match: /disabilit/,
  },
  {
    key: "lgbtq",
    label: "Do you identify as LGBTQ+? (some forms ask)",
    group: "Voluntary self-identification",
    options: ["Yes", "No", DECLINE],
    match: /(lgbt|sexual orientation|transgender)/,
  },
];

export const APP_QUESTION_GROUPS = ["Eligibility", "Availability & pay", "Background", "Voluntary self-identification"] as const;

export type AppAnswers = Record<string, string>;

/** The saved question whose wording matches this form label, if any. */
export function questionFor(label: string): AppQuestion | null {
  const l = label.toLowerCase().replace(/\s+/g, " ");
  for (const q of APP_QUESTIONS) if (q.match.test(l) && !(q.not && q.not.test(l))) return q;
  return null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const YES = /^(yes|y|true)\b/i;
const NO = /^(no|n|false)\b/i;
const IS_DECLINE = /(decline|prefer not|don.?t wish|do not wish|choose not|not to (say|answer|disclose)|rather not|i don.?t want)/i;

/**
 * Picks the form option that means the same as the user's saved answer.
 * Returns null when nothing fits (then the AI or the user decides).
 */
export function pickOption(answer: string, options: string[]): string | null {
  if (!options.length) return answer;
  const a = squash(answer);
  if (!a) return null;
  const exact = options.find((o) => squash(o) === a);
  if (exact) return exact;
  if (IS_DECLINE.test(answer)) return options.find((o) => IS_DECLINE.test(o)) ?? null;
  if (YES.test(answer)) return options.find((o) => YES.test(o.trim())) ?? null;
  if (NO.test(answer)) return options.find((o) => NO.test(o.trim())) ?? options.find((o) => /\bnot\b/i.test(o) && !IS_DECLINE.test(o)) ?? null;
  // Veteran / disability style answers: "I am not a protected veteran" ↔ "No, I am not…"
  const negative = /\b(not|no|don.?t|do not)\b/.test(a);
  const scored = options
    .filter((o) => !IS_DECLINE.test(o) && /\b(not|no|don.?t|do not)\b/.test(squash(o)) === negative)
    .map((o) => {
      const ow = new Set(squash(o).split(" "));
      const hits = a.split(" ").filter((w) => w.length > 2 && ow.has(w)).length;
      return { o, hits };
    })
    .sort((x, y) => y.hits - x.hits);
  if (scored[0]?.hits) return scored[0].o;
  const contains = options.find((o) => squash(o).includes(a) || a.includes(squash(o)));
  return contains ?? null;
}

/** Profile answer for a form field, already mapped onto its options. */
export function answerFromProfile(label: string, options: string[], answers: AppAnswers): string | null {
  const q = questionFor(label);
  if (!q) return null;
  let v = answers[q.key]?.trim();
  if (!v) return null;
  // A yes/no form question for a saved multi-choice answer ("Can you work onsite?" ← "Remote only").
  const yesNo = options.length > 0 && options.some((o) => YES.test(o.trim())) && options.some((o) => NO.test(o.trim()));
  if (yesNo && !YES.test(v) && !NO.test(v)) {
    const derived: Record<string, (x: string) => boolean | null> = {
      work_mode: (x) => !/remote only/i.test(x),
      willing_to_travel: (x) => !/^no/i.test(x),
      security_clearance: (x) => !/^none/i.test(x),
      visa_status: (x) => /citizen|green card|permanent/i.test(x),
    };
    const d = derived[q.key]?.(v);
    if (d == null) return null;
    v = d ? "Yes" : "No";
  }
  return options.length ? pickOption(v, options) : v;
}

// ── Remembered answers (saves AI calls) ─────────────────────────────────
/** Normalised question text, used as the memory key. */
export const memoryKey = (label: string) => squash(label).slice(0, 160);

/** Answers that depend on the specific company/job and must not be reused elsewhere. */
export function isJobSpecific(label: string, company: string): boolean {
  const l = label.toLowerCase();
  if (company && company.length > 2 && l.includes(company.toLowerCase())) return true;
  return /(why (do you|are you|this|our|us)|cover letter|tell us about|describe|interest(ed)? in (this|the) (role|position|company)|what excites|motivat|additional information|anything else)/.test(l);
}

export function rememberAnswers(memory: AppAnswers, learned: { label: string; answer: string; company: string }[], max = 300): AppAnswers {
  const out = { ...memory };
  for (const x of learned) {
    if (!x.answer?.trim() || isJobSpecific(x.label, x.company)) continue;
    out[memoryKey(x.label)] = x.answer;
  }
  const keys = Object.keys(out);
  if (keys.length > max) for (const k of keys.slice(0, keys.length - max)) delete out[k];
  return out;
}

// ── Questions the agent couldn't answer → asked to the user, then reused ──
/** A required form question with no known answer, shown on Applications → Needs you. */
export interface PendingQuestion {
  key: string;
  label: string;
  kind: string;
  options: string[];
  required: boolean;
}
/** The user's answers to such questions: memoryKey → { q: question as asked, a: answer }. */
export type CustomAnswers = Record<string, { q: string; a: string; at?: string }>;

const STOP = new Set(
  "a an the of to in on at for and or is are am be been do does did you your yours we our us this that these those it its with as by from will would can could please any if have has had what which who how when where there here about required select one all apply".split(" ")
);
/** The words that carry a question's meaning. */
export const questionWords = (label: string) => new Set(squash(label).split(" ").filter((w) => (w.length > 1 || /\d/.test(w)) && !STOP.has(w)));

/** 0–1 overlap between two questions' meaningful words. */
export function questionSimilarity(a: string, b: string): number {
  const x = questionWords(a);
  const y = questionWords(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/**
 * Answer for `label` from a store of earlier answers: the same question, or a very similar one
 * ("Do you have 3+ years of Python?" ≈ "Do you have 3+ years of experience with Python?").
 * With options, the answer must map onto one of them.
 */
export function findSimilarAnswer(label: string, options: string[], store: Record<string, string>, min = 0.75): string | null {
  const fit = (v: string) => (options.length ? pickOption(v, options) : v);
  const exact = store[memoryKey(label)];
  if (exact) {
    const v = fit(exact);
    if (v) return v;
  }
  if (questionWords(label).size < 2) return null;
  let best: { v: string; s: number } | null = null;
  for (const [k, ans] of Object.entries(store)) {
    const s = questionSimilarity(label, k);
    if (s >= min && (!best || s > best.s)) {
      const v = fit(ans);
      if (v) best = { v, s };
    }
  }
  return best?.v ?? null;
}

/** CustomAnswers → plain memoryKey → answer map. */
export const customStore = (c: CustomAnswers | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(c ?? {}).map(([k, v]) => [k, v?.a ?? ""]).filter(([, a]) => a));

// ── Common sense ─────────────────────────────────────────────────────────
/**
 * What a sensible applicant answers when they haven't saved an answer themselves.
 * Only low-stakes, never-misleading answers: nothing about demographics, disability,
 * criminal history or anything that would be a false claim.
 */
export function commonSenseAnswer(label: string, options: string[], kind: string): string | null {
  const l = squash(label);
  const q = questionFor(label)?.key;
  const pick = (...prefs: RegExp[]) => {
    if (!options.length) return null;
    for (const re of prefs) {
      const hit = options.find((o) => re.test(o));
      if (hit) return hit;
    }
    return null;
  };
  const yes = () => (options.length ? pickOption("Yes", options) : "Yes");
  const no = () => (options.length ? pickOption("No", options) : "No");

  // "How did you hear about us?" — never claim a referral or a person that didn't happen.
  if (q === "how_heard") {
    if (!options.length) return "LinkedIn";
    return pick(/^linkedin\b(?!.*(employee|recruiter|post by))/i, /linkedin/i, /company (web)?site|careers? (page|site)/i, /job (board|site|posting)/i, /indeed|glassdoor|google|online|internet|web/i, /^other\b/i);
  }
  // Referrals / knowing employees / relatives: the honest default is No.
  if (/(referred|referral|know (anyone|someone)|relative|family member|related to).{0,80}(employ|work|compan|organi[sz]ation|here)|were you referred|employee referral/.test(l) && !/name of/.test(l))
    return kind === "text" || kind === "textarea" ? (/name|who/.test(l) ? "N/A" : "No") : no();
  // Pay: "Negotiable" is a normal answer and never disqualifies.
  if (q === "desired_salary" && (kind === "text" || kind === "textarea")) return "Negotiable";
  if (q === "start_date" && (kind === "text" || kind === "textarea")) return "Flexible — I can start soon after an offer";
  if (q === "notice_period" && (kind === "text" || kind === "textarea")) return "2 weeks";
  if (q === "notice_period" && options.length) return pick(/2 weeks|two weeks/i, /immediate/i);
  // Standard consents to apply.
  if (/(background check|drug (test|screen)|reference check|e-?verify)/.test(l) && /(willing|consent|agree|able|submit|undergo|authori[sz]e)/.test(l)) return yes();
  // Texting/marketing opt-ins: leave unticked / say No (checked before generic "I agree").
  const optIn = /(text message|sms|marketing|newsletter|talent (community|network)|future (job )?opportunities|job alerts)/.test(l) && /(opt|consent|receive|subscribe|join|agree|send)/.test(l);
  if (optIn) return kind === "checkbox" ? null : no();
  if (/(i (agree|acknowledge|consent|certify|confirm|understand|have read))|privacy (policy|notice)|terms (and|&) conditions|accurate (and|&) complete|true and correct/.test(l))
    return kind === "checkbox" || kind === "checkboxes" ? "yes" : yes();
  return null;
}
