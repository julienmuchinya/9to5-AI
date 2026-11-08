import type { Posting } from "./discovery/sources";
import { domainOf } from "./discovery/filters";

export interface Signal {
  code: string;
  points: number;
  message: string;
}
export type VerificationStatus = "verified" | "review" | "rejected";
export interface Verification {
  status: VerificationStatus;
  score: number;
  signals: Signal[];
}

/** Applicant-tracking systems run by real hiring vendors; employers need paid accounts. */
const TRUSTED_ATS_HOSTS = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com", "workday.com", "smartrecruiters.com",
  "icims.com", "jobvite.com", "taleo.net", "oraclecloud.com", "successfactors.com", "bamboohr.com",
  "workable.com", "recruitee.com", "breezy.hr", "jazzhr.com", "applytojob.com", "rippling.com",
  "dover.com", "eightfold.ai", "avature.net", "phenompeople.com", "ultipro.com", "paylocity.com",
];
/** Hosts scammers commonly use for fake applications. */
const BAD_HOSTS = [
  "forms.gle", "docs.google.com", "sites.google.com", "bit.ly", "tinyurl.com", "t.co", "rebrand.ly",
  "wixsite.com", "weebly.com", "carrd.co", "telegram.me", "t.me", "wa.me", "whatsapp.com", "jotform.com",
  "typeform.com", "linktr.ee", "000webhostapp.com", "blogspot.com",
];
/** Sources that already filter postings (curated lists, official board APIs). */
const CURATED_SOURCES = new Set([
  "simplify_internships", "simplify_new_grad", "greenhouse", "lever", "ashby",
]);

const SCAM_PATTERNS: [RegExp, string, number][] = [
  [/(pay|purchase|buy).{0,30}(training|equipment|software|starter kit|certification)/i, "PAY_TO_WORK", 60],
  [/(send|deposit|cash).{0,20}(check|cheque)|check (deposit|cashing)/i, "CHECK_SCAM", 70],
  [/\b(telegram|whatsapp|signal app|google hangouts?)\b.{0,40}(interview|contact|message|chat)/i, "CHAT_APP_INTERVIEW", 60],
  [/(upfront|registration|processing|application) fee/i, "UPFRONT_FEE", 60],
  [/\b(social security number|ssn|bank account (number|details)|routing number)\b/i, "ASKS_SENSITIVE_DATA", 50],
  [/no (interview|experience) (needed|required).{0,40}(\$|earn|weekly)/i, "TOO_EASY_MONEY", 35],
  [/\b(crypto|bitcoin|usdt|gift cards?)\b.{0,40}(pay|payment|salary|compensat)/i, "CRYPTO_PAY", 60],
  [/earn \$\d{3,5}\s*(\/|per)\s*(day|week)/i, "UNREALISTIC_EARNINGS", 40],
  [/reshipping|package (forwarding|reshipper)|mystery shopper|payment processing agent/i, "KNOWN_SCAM_ROLE", 80],
  [/[\w.+-]+@(gmail|yahoo|hotmail|outlook|aol|proton(mail)?|icloud)\.com/i, "FREE_EMAIL_CONTACT", 35],
];

const hostMatches = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** Text and link checks on one posting. Network checks for the company live in verifyCompanyDomain. */
export function verifyPosting(p: Posting, companyDomainOk?: boolean): Verification {
  const signals: Signal[] = [];
  let score = 50;
  const add = (code: string, points: number, message: string) => {
    signals.push({ code, points, message });
    score += points;
  };

  const host = domainOf(p.apply_url || p.url) ?? "";
  if (!/^https:\/\//i.test(p.apply_url || p.url)) add("NOT_HTTPS", -30, "Application link is not HTTPS");
  if (hostMatches(host, BAD_HOSTS)) add("BAD_LINK_HOST", -60, `Application goes to ${host}, often used by scams`);
  else if (hostMatches(host, TRUSTED_ATS_HOSTS)) add("TRUSTED_ATS", 30, `Hosted on employer hiring system (${host})`);

  if (CURATED_SOURCES.has(p.source)) add("CURATED_SOURCE", 15, `Found via ${p.source.replace("_", " ")} (vetted list or official board)`);

  if (companyDomainOk === true) add("COMPANY_SITE_OK", 15, "Company website exists and loads over HTTPS");
  if (companyDomainOk === false) add("COMPANY_SITE_MISSING", -25, "Could not find a working company website");

  const text = `${p.title}\n${p.description ?? ""}`;
  for (const [re, code, weight] of SCAM_PATTERNS) {
    if (re.test(text)) add(code, -weight, `Scam warning sign: ${code.toLowerCase().replace(/_/g, " ")}`);
  }

  if (p.salary_max && p.salary_max > 450_000 && (p.level === "internship" || p.level === "new_grad" || p.level === "entry"))
    add("SALARY_UNREALISTIC", -30, "Pay looks unrealistic for this level");
  if (!p.company_name || /^(confidential|stealth|unknown|private)$/i.test(p.company_name.trim()))
    add("NO_COMPANY_NAME", -20, "Employer name is hidden");

  score = Math.max(0, Math.min(100, score));
  const severe = signals.some((s) => s.points <= -60);
  const status: VerificationStatus = severe || score < 50 ? "rejected" : score >= 75 ? "verified" : "review";
  return { status, score, signals };
}

/** Does the employer's own website exist? Used for postings outside trusted hiring systems. */
export async function verifyCompanyDomain(domain?: string): Promise<boolean | undefined> {
  if (!domain) return undefined;
  try {
    const res = await fetch(`https://${domain}`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "9to5-ai-verifier" },
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Only these are eligible for automatic submission. */
export const AUTO_SUBMIT_ATS = new Set(["greenhouse", "lever", "ashby"]);
/** Sites whose plain application form the agent fills, whatever the posting's ats label says. */
// Rippling: guest form, no account, no CAPTCHA (checked Nov 2026).
export const AUTO_SUBMIT_HOSTS = ["apply.workable.com", "ats.rippling.com"];
export function canAutoSubmit(p: { ats?: string | null; verification_status?: string | null; apply_url?: string | null; url?: string }): boolean {
  if (p.verification_status !== "verified") return false;
  const host = domainOf(p.apply_url || p.url) ?? "";
  // Workable: a normal form with no CAPTCHA on load (checked Nov 2026). SmartRecruiters is NOT here:
  // its form sits behind a CAPTCHA wall for automated browsers, so those stay "apply yourself".
  if (hostMatches(host, AUTO_SUBMIT_HOSTS)) return true;
  if (!p.ats || !AUTO_SUBMIT_ATS.has(p.ats)) return false;
  return hostMatches(host, ["greenhouse.io", "lever.co", "ashbyhq.com"]);
}
