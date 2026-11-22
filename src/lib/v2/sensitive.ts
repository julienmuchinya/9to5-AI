/**
 * Questions the agent must never answer, never send to an AI and never fill from memory.
 *
 * "scam": no real employer asks for this on a job application (before an offer, through a proper HR
 * system). A form that does is treated as a fake posting: nothing is filled, nothing is submitted, and the
 * posting is marked as suspicious so no one is sent to it again.
 * "private": legitimate employers sometimes ask (e.g. full date of birth for a background check), but the
 * agent still leaves it to the applicant to type themselves.
 */
export type SensitiveLevel = "scam" | "private";
export interface SensitiveHit {
  level: SensitiveLevel;
  /** What it asks for, in plain words ("your Social Security number"). */
  what: string;
}

const RULES: { re: RegExp; level: SensitiveLevel; what: string }[] = [
  { re: /social security|\bssn\b|\bsocial insurance\b|\bsin number\b|\bss ?#/, level: "scam", what: "your Social Security number" },
  { re: /\b(itin|ein|tin)\b|taxpayer identification|tax (id|identification) (number|no)/, level: "scam", what: "a tax ID number" },
  { re: /(bank|checking|savings) account( number| no|#)?|routing (number|no|#)|\baba\b number|\biban\b|swift code|sort code|direct deposit/, level: "scam", what: "bank account details" },
  { re: /(credit|debit) card|card (number|no|#)|\bcvv\b|\bcvc\b|security code on (the|your) card|expiration date.{0,20}card|billing address/, level: "scam", what: "card / payment details" },
  { re: /passport (number|no|#)|passport id/, level: "scam", what: "your passport number" },
  { re: /(driver'?s?|driving) licen[cs]e (number|no|#)|\bdl ?(number|#)|state id (number|no|#)|id card number/, level: "scam", what: "an ID card number" },
  { re: /alien (registration|number)|\ba-?number\b|uscis (number|#)|i-94 (number|#)|green card number/, level: "scam", what: "an immigration document number" },
  { re: /mother'?s maiden name|security question answer|answer to (your|a) security question/, level: "scam", what: "a security-question answer" },
  { re: /\bpin\b( code| number)?$|\bpin\b.{0,20}(bank|card|account)|one[- ]time (pass)?code (from|sent to) your (phone|bank)/, level: "scam", what: "a PIN / bank code" },
  { re: /(e-?mail|gmail|outlook|yahoo|icloud|facebook|linkedin|bank|paypal|venmo|zelle|cash ?app).{0,25}password|password.{0,25}(e-?mail|gmail|bank|paypal)/, level: "scam", what: "the password to one of your accounts" },
  { re: /(paypal|venmo|zelle|cash ?app|crypto|bitcoin|wallet) (account|address|id|username|handle)|(pay|send).{0,30}(fee|deposit) (to|for) (apply|training|equipment)/, level: "scam", what: "payment-app details" },
  { re: /date of birth|birth ?date|\bdob\b|(month|day|year) (of|you were) born|when were you born/, level: "private", what: "your full date of birth" },
];

const squash = (s: string) => s.toLowerCase().replace(/[\s*✱:]+$/g, "").replace(/\s+/g, " ").trim();

/** Is this question asking for something the agent must never give out? */
export function sensitiveField(label: string, kind = "text"): SensitiveHit | null {
  const l = squash(label);
  if (!l) return null;
  // "Are you 18 or older?" / "Do you have a valid driver's license?" are normal yes/no questions — only a
  // box that asks you to TYPE the number/value counts.
  const yesNo = kind === "radio" || kind === "checkbox" || /^(are|do|does|have|has|will|can|is|would|did)\b/.test(l);
  for (const r of RULES) {
    if (!r.re.test(l)) continue;
    if (yesNo && !/(enter|provide|type|number|#)/.test(l)) continue;
    // A notice ("We will never ask for your SSN or bank details") is not a request.
    if (/(never|will not|won'?t|do not|don'?t) (ask|request|require)/.test(l)) continue;
    return { level: r.level, what: r.what };
  }
  return null;
}

/**
 * A password box only belongs on a career portal's own sign-in / create-account step (Workday, iCIMS,
 * Taleo…). Greenhouse, Lever, Ashby and the other plain application forms never ask for one.
 */
export const PORTAL_SITES = /(myworkdayjobs\.com|myworkdaysite\.com|icims\.com|taleo\.net|successfactors\.(com|eu)|oraclecloud\.com|brassring\.com|ultipro\.com|ukg\.net|avature\.net|phenompeople\.com)/i;

export function suspiciousPassword(label: string, kind: string, url: string): boolean {
  const l = squash(label);
  const isPassword = kind === "password" || /\bpassword\b|\bpasscode\b/.test(l);
  return isPassword && !PORTAL_SITES.test(url);
}

/**
 * Removes anything sensitive from facts/answers before they go into an AI prompt or the answer memory.
 * Keys or values that look like an SSN, a card or account number, or a password are dropped.
 */
export function scrubFacts<T extends Record<string, unknown>>(facts: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(facts ?? {})) {
    if (sensitiveField(k.replace(/_/g, " "))?.level === "scam" || /password|secret|token|api.?key/i.test(k)) continue;
    if (typeof v === "string" && looksLikeSecretValue(v)) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? scrubFacts(v as Record<string, unknown>) : v;
  }
  return out as T;
}

/** "123-45-6789", a 13–19 digit card number, a 9-digit routing number on its own. */
export function looksLikeSecretValue(v: string): boolean {
  const t = v.trim();
  if (/^\d{3}-\d{2}-\d{4}$/.test(t)) return true; // SSN
  const digits = t.replace(/[\s-]/g, "");
  if (/^\d{13,19}$/.test(digits) && luhn(digits)) return true; // payment card
  return false;
}

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
