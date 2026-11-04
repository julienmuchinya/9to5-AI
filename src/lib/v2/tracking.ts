/** Application status tracking: email classification, stage ordering, role families. */

export type Stage = "submitted" | "received" | "under_review" | "interview" | "offer" | "rejected";

export const STAGE_LABEL: Record<string, string> = {
  queued: "Queued for next run",
  needs_user: "Needs you",
  submitted: "Submitted",
  received: "Application received",
  under_review: "Under consideration",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  failed: "Failed",
  closed: "Posting closed",
};

// Higher = further along. Rejected/offer are final.
const RANK: Record<string, number> = { queued: 0, needs_user: 0, failed: 0, submitted: 1, received: 2, under_review: 3, interview: 4, offer: 6, rejected: 6, withdrawn: 6 };

/** Moves forward only; never un-rejects. Interview can still become offer or rejected. */
export function nextStatus(current: string, incoming: Stage): string {
  if (current === "offer" || current === "rejected" || current === "withdrawn") return current;
  if (incoming === "rejected" || incoming === "offer") return incoming;
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : current;
}

const RULES: { stage: Stage; re: RegExp }[] = [
  {
    stage: "rejected",
    re: /(unfortunately|regret to inform|not (be )?(moving|move) forward|decided (not )?to (move|pursue) (forward )?with other|pursue other candidates|no longer (being )?considered|position has been filled|will not be proceeding|not selected|other applicants whose)/i,
  },
  { stage: "offer", re: /(pleased to (extend|offer)|offer letter|we('d| would) like to offer you|job offer)/i },
  {
    stage: "interview",
    re: /(schedule (an? |your )?(interview|call|chat|time)|interview (invitation|request)|invite you to (an? )?(interview|call|chat)|phone screen|technical (interview|screen)|coding (challenge|assessment)|online assessment|hirevue|codesignal|hackerrank|availability for (an? )?(call|interview)|next round)/i,
  },
  { stage: "under_review", re: /(under (review|consideration)|reviewing your (application|profile)|moved to the next (step|stage)|shortlisted)/i },
  { stage: "received", re: /(thank(s| you) for (applying|your application|your interest)|we('ve| have) received your application|application (has been )?(received|submitted)|application confirmation)/i },
];

/** Classifies a recruiting email without AI (free). Returns null for unrelated mail. */
export function classifyEmail(subject: string, body: string): Stage | null {
  const text = `${subject}\n${body}`.slice(0, 6000);
  for (const r of RULES) if (r.re.test(text)) return r.stage;
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SUFFIX = / (inc|llc|ltd|corp|corporation|co|company|technologies|technology|labs|group|holdings)$/;

/** Does this email mention the company? Uses the sender domain and name. */
export function emailMentionsCompany(company: string, from: string, subject: string, body: string): boolean {
  const c = norm(company).replace(SUFFIX, "").trim();
  if (c.length < 2) return false;
  const squashed = c.replace(/ /g, "");
  const fromN = from.toLowerCase();
  if (squashed.length >= 3 && fromN.replace(/[^a-z0-9]/g, "").includes(squashed)) return true;
  const hay = ` ${norm(`${subject} ${body.slice(0, 3000)}`)} `;
  return hay.includes(` ${c} `);
}

/** Groups jobs into broad role families for "what's working" stats. */
export function roleFamily(title: string): string {
  const t = title.toLowerCase();
  if (/(machine learning|\bml\b|\bai\b|deep learning|nlp|computer vision|llm)/.test(t)) return "AI / ML";
  if (/(data (scien|analy|engineer)|analytics|business intelligence|\bbi\b)/.test(t)) return "Data";
  if (/(security|cyber)/.test(t)) return "Security";
  if (/(devops|site reliability|\bsre\b|cloud|infrastructure|platform)/.test(t)) return "Cloud / DevOps";
  if (/(front ?end|ui engineer|web)/.test(t)) return "Frontend / Web";
  if (/(back ?end|server|api)/.test(t)) return "Backend";
  if (/(mobile|ios|android)/.test(t)) return "Mobile";
  if (/(hardware|electrical|embedded|firmware|mechanical|robotics)/.test(t)) return "Hardware / Embedded";
  if (/(software|developer|engineer|swe|programmer)/.test(t)) return "Software (general)";
  return "Other STEM";
}

/** Short label of what the tailored resume led with, e.g. "Python · React · AWS". */
export function resumeFocus(skillsInOrder: string[] | undefined): string | null {
  const s = (skillsInOrder ?? []).slice(0, 3);
  return s.length ? s.join(" · ") : null;
}
