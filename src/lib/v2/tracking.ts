/** Application status tracking: email classification, stage ordering, role families. */

export type Stage = "submitted" | "received" | "under_review" | "screening" | "interview" | "offer" | "rejected";

export const STAGE_LABEL: Record<string, string> = {
  queued: "Queued for next run",
  needs_user: "Needs you",
  submitted: "Submitted",
  received: "Application received",
  under_review: "Under consideration",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  failed: "Failed",
  closed: "Posting closed",
  ignored: "Ignored",
  draft: "Draft",
  note: "Note",
};

// Higher = further along. Rejected/offer are final.
const RANK: Record<string, number> = { queued: 0, needs_user: 0, failed: 0, submitted: 1, received: 2, under_review: 3, screening: 4, interview: 5, offer: 7, rejected: 7, withdrawn: 7 };

/** Moves forward only; never un-rejects. Interview can still become offer or rejected. */
export function nextStatus(current: string, incoming: Stage): string {
  if (current === "offer" || current === "rejected" || current === "withdrawn") return current;
  if (incoming === "rejected" || incoming === "offer") return incoming;
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : current;
}

const RULES: { stage: Stage; re: RegExp }[] = [
  {
    // A bare "unfortunately" isn't a rejection ("Unfortunately we can't reply to every applicant individually").
    stage: "rejected",
    re: /(regret to inform|unfortunately,? (we|after|the|your|at this time)[^.]{0,120}(not|other candidates|another candidate|filled|won.t|will not)|not (be )?(moving|move) forward with (you|your)|decided (not )?to (move|pursue|proceed) (forward )?with other|pursue other candidates|no longer (being )?considered|position has been filled|will not be proceeding|(have|were|was) not (been )?selected|other applicants whose|not (to )?(move|proceed) forward with your)/i,
  },
  { stage: "offer", re: /(pleased to (extend|offer)|offer letter|we('d| would) like to offer you|job offer)/i },
  {
    // Real interviews with the team: onsite / virtual onsite / technical or final rounds.
    stage: "interview",
    re: /(technical interview|final (round|interview)|on-?site interview|virtual on-?site|panel interview|interview (with|loop)|meet (with )?the (team|hiring manager)|hiring manager interview|schedule (an? |your )interview|interview (invitation|request)|invite you to (an? )?interview|next round|interview (is |has been )?(scheduled|confirmed)|(your|an|the) interview (on|at|for) )/i,
  },
  {
    // First filter: recruiter / phone screen, online assessment, coding test, recorded video.
    stage: "screening",
    re: /(phone screen|recruiter (call|screen|chat)|screening (call|interview)|initial (call|conversation|chat)|intro(ductory)? call|online assessment|coding (challenge|assessment|test)|technical (screen|assessment)|take-?home|hirevue|codesignal|hackerrank|codility|karat|schedule (a |your )?(call|chat|time)|(set up|arrange|book) (a |an )?(quick |brief |short )?(call|chat|phone)|availability for (an? )?(call|chat)|(are you|you are|you.re) available for (an? )?(quick )?(call|chat|phone))/i,
  },
  { stage: "under_review", re: /(under (review|consideration)|reviewing your (application|profile)|moved to the next (step|stage)|shortlisted)/i },
  { stage: "received", re: /(thank(s| you) for (applying|your application|your interest)|we('ve| have) received your application|received your application|application (has been )?(received|submitted)|application confirmation|we('ve| have) got (it|your)|application [^.\n]{0,120}\bis underway)/i },
];

/** Job boards, alerts and newsletters: they mention companies and "interview" but say nothing about YOUR application. */
const NOT_AN_EMPLOYER =
  /(linkedin|indeed|glassdoor|ziprecruiter|monster|careerbuilder|dice\.com|handshake|joinhandshake|simplify|wellfound|angel\.co|jobright|jobot|talent\.com|builtin|themuse|hired\.com|otta|welcometothejungle|google careers|jobalert|job-alert|jobs-noreply|newsletter|digest|substack|medium\.com)/i;
const ALERT_SUBJECT = /(jobs? (alert|for you|recommendation)|new jobs?|recommended (jobs|for you)|jobs you may|similar jobs|apply now to|is hiring|are hiring|top jobs|job matches|interview (tips|prep|guide|questions)|webinar|career fair|newsletter)/i;

/**
 * Sentences that describe what MIGHT happen ("If your background matches, a recruiter will contact you to
 * schedule an interview") are part of almost every confirmation email. Read literally they marked plain
 * "thanks for applying" emails as interviews; they're removed before looking for a stage.
 */
const HYPOTHETICAL =
  /((?<!\b(?:know|see|check|confirm)\s)\bif (you|your|we|selected|there|our|it|qualified|chosen)\b|\bshould (you|your|we|there)\b|\bin the event\b|\bmay (be )?(contact|reach|invite|ask|include|schedule)|\bmight\b|\bwould be (contacted|invited)|\bwill (contact|reach out to|be in touch with) (you|candidates|applicants)[^.]{0,60}\b(if|whose|who|should)\b|\b(typically|usually|generally|often) (include|involve|consist)|\bour (hiring|interview|recruiting) process\b|\bnext steps (may|could|will) include\b|\bselected (candidates|applicants)\b|\bunable to (respond|reply)|\b(every|each) (applicant|candidate|application) individually\b|\bdue to the (high )?volume\b|\bshortlisted candidates\b|\bonly (those|candidates)\b)/i;

/** Proof of an actual invitation: a booking link or a direct ask for your time. */
const REAL_INVITE =
  /(calendly\.com|goodtime\.io|cal\.com\/|greenhouse\.io\/.*schedul|schedul(e|ing)\.(greenhouse|lever|ashby)|modernhire|select (a|your) (time|slot)|book (a|your) (time|slot)|pick (a|your) time|your availability|let (us|me) know (your|when you.re) availab|(would|we.d) (like|love) to (invite|schedule|set up|speak|chat|talk|meet)|invite you to|invitation to (interview|speak|chat)|please (complete|take) (the|this|your|our) (assessment|challenge|test)|has been scheduled|is (scheduled|confirmed) for|interview (is )?(confirmed|scheduled)|(are you|you are|you're) available (for|on|to|this|next)|available (for|on) (a |an )?(call|chat|interview|conversation))/i;

const STRONG_HYPOTHETICAL =
  /(\bif (you are |you're |you have been )?(selected|chosen|shortlisted|qualified|a (good |strong )?(fit|match))|\bif your (background|experience|skills|qualifications|profile|application)|\bshould (you|your) (be|background|experience|skills|qualifications|profile|application)|\bin the event\b|\bselected (candidates|applicants)\b|\bshortlisted candidates\b|\bonly (those|candidates)\b|\bmay (be )?(contact|invite)|\bmight\b)/i;

/**
 * A sentence that puts a condition on what follows ("If we determine you're a match, we'll invite you to
 * interview", "Once we've reviewed it, we'd love to schedule a call") is never a real invitation, even when it
 * contains invitation words. "Let us know if you're available" is a question, not a condition, so it stays.
 */
const CONDITION =
  /((?<!\b(?:know|see|check|wonder|wondering|ask|asking|confirm|tell us|tell me)\s)\bif\b|\bonce (?:we|we've|we have|we've|our|your|the|you|you've)\b|\bshould (?:we|you|your|there|it)\b|\bin the event\b|\bwhenever\b|\bprovided (?:that )?(?:you|your|we)\b|\b(?:candidates|applicants) (?:who|that|whose)\b|\bafter (?:we|our|the team) (?:review|have reviewed|reviewed)\b)/i;

const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

/** Classifies a recruiting email without AI (free). Returns null for unrelated mail. `from` filters out job boards. */
export function classifyEmail(subject: string, body: string, from = ""): Stage | null {
  if (from && NOT_AN_EMPLOYER.test(from)) return null;
  if (ALERT_SUBJECT.test(subject)) return null;
  // Keep only sentences that state a fact about this application.
  // "Let us know if you're available Tuesday" has an "if" but is a real invite; "if selected, we'll invite you" isn't.
  const facts = sentences(`${subject}\n${body}`.slice(0, 6000)).filter((x) => !STRONG_HYPOTHETICAL.test(x) && !CONDITION.test(x) && (!HYPOTHETICAL.test(x) || REAL_INVITE.test(x)));
  const text = facts.join("\n");
  const confirmation = RULES[RULES.length - 1].re.test(`${subject}\n${body.slice(0, 800)}`);
  for (const r of RULES) {
    if (!r.re.test(text)) continue;
    // A confirmation email only moves past "received" when it really invites you (a booking link, an ask for your time).
    if (confirmation && (r.stage === "interview" || r.stage === "screening") && !REAL_INVITE.test(text)) return "received";
    if (confirmation && r.stage === "under_review") return "received";
    return r.stage;
  }
  return null;
}

/** Link that opens one email in Gmail (Gmail API id, or an IMAP Message-ID), else a search for its subject. */
export function gmailLink(inbox: string | null | undefined, messageId: string | null | undefined, subject?: string | null): string | null {
  const who = inbox ? `?authuser=${encodeURIComponent(inbox)}` : "";
  const base = `https://mail.google.com/mail/u/${who}`;
  const id = (messageId ?? "").trim();
  if (/^[0-9a-f]{12,20}$/i.test(id)) return `${base}#all/${id}`;
  if (id.includes("@")) return `${base}#search/${encodeURIComponent(`rfc822msgid:${id.replace(/^<|>$/g, "")}`)}`;
  const s = (subject ?? "").replace(/["\n]/g, " ").trim().slice(0, 150);
  return s ? `${base}#search/${encodeURIComponent(`subject:"${s}"`)}` : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SUFFIX = / (inc|llc|ltd|corp|corporation|co|company|technologies|technology|labs|group|holdings)$/;

/** Applicant-tracking systems that send mail on an employer's behalf. */
const ATS_SENDER = /(greenhouse|lever\.co|ashbyhq|myworkday|workday|icims|smartrecruiters|jobvite|jazzhr|applytojob|workable|rippling|successfactors|taleo|brassring|avature|oraclecloud|eightfold|phenom|paradox|hirevue|codesignal|hackerrank|codility|karat|bamboohr|recruitee|teamtailor|breezy|pinpointhq|dayforce|ultipro|ukg|paylocity|adp)/i;

/**
 * Does this email come from (or on behalf of) the company? The sender, or the subject, must name it — or it
 * comes from an applicant-tracking system and the body names it. A body mention alone (a newsletter that
 * lists twenty employers) no longer counts.
 */
export function emailMentionsCompany(company: string, from: string, subject: string, body: string): boolean {
  const c = norm(company).replace(SUFFIX, "").trim();
  if (c.length < 2) return false;
  const squashed = c.replace(/ /g, "");
  const fromN = from.toLowerCase();
  if (squashed.length >= 3 && fromN.replace(/[^a-z0-9]/g, "").includes(squashed)) return true;
  if (` ${norm(subject)} `.includes(` ${c} `)) return true;
  return ATS_SENDER.test(fromN) && ` ${norm(body.slice(0, 3000))} `.includes(` ${c} `);
}

/** How many words of the job title appear in the email (picks the right application when a company has several). */
export function titleOverlap(title: string, subject: string, body: string): number {
  const hay = ` ${norm(`${subject} ${body.slice(0, 3000)}`)} `;
  return norm(title)
    .split(" ")
    .filter((w) => w.length >= 3 && !/^(and|the|for|with|senior|junior|intern|internship|remote)$/.test(w))
    .filter((w) => hay.includes(` ${w} `)).length;
}

/** Status after replaying a timeline's stage events in order (used after removing a wrong one). */
export function statusFromEvents(base: string, kinds: string[]): string {
  let s = base;
  for (const k of kinds) if (k in RANK && k !== "queued" && k !== "needs_user" && k !== "failed") s = k === "withdrawn" ? "withdrawn" : nextStatus(s, k as Stage);
  return s;
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
  if (/(software|developer|swe|programmer)/.test(t)) return "Software (general)";
  if (/(nurse|\brn\b|lpn|cna|medical|clinical|pharm|therap|patient|health|caregiver|dental|physician)/.test(t)) return "Healthcare";
  if (/(oil|gas|petroleum|drill|roustabout|offshore|pipeline|refinery|operator|field service|mining|energy)/.test(t)) return "Energy / Field";
  if (/(technician|mechanic|electrician|welder|maintenance|hvac|plumber|carpenter|construction|installer)/.test(t)) return "Skilled trades";
  if (/(driver|cdl|warehouse|logistics|forklift|delivery|supply chain|dispatcher)/.test(t)) return "Logistics / Driving";
  if (/(account|finance|financial|bank|teller|audit|tax|loan|underwrit|insurance|claims)/.test(t)) return "Finance / Banking";
  if (/(sales|retail|store|cashier|customer|associate|merchandis)/.test(t)) return "Retail / Customer";
  if (/(admin|office|assistant|receptionist|clerk|coordinator|\bhr\b|human resources|recruit)/.test(t)) return "Office / Admin";
  if (/(teacher|tutor|instructor|education|school)/.test(t)) return "Education";
  if (/engineer/.test(t)) return "Engineering";
  return "Other";
}

/** Short label of what the tailored resume led with, e.g. "Python · React · AWS". */
export function resumeFocus(skillsInOrder: string[] | undefined): string | null {
  const s = (skillsInOrder ?? []).slice(0, 3);
  return s.length ? s.join(" · ") : null;
}
