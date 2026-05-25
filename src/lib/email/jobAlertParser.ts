import { isBlockedJobUrl } from "./emailFilters";

export type JobAlertSource =
  | "linkedin_email"
  | "indeed_email"
  | "handshake_email"
  | "glassdoor_email"
  | "wellfound_email"
  | "simplify_email"
  | "google_email"
  | "company_career_alert"
  | "gmail_alert"
  | "unknown_email";

export interface ParsedJobAlertEmail {
  companyName: string;
  title: string;
  url?: string;
  location?: string;
  remoteType?: "remote" | "hybrid" | "on-site" | "unknown";
  source: JobAlertSource;
  postedDate?: string;
  shortDescription?: string;
  rawEmailRef: string;
  dateFound: string;
  description: string;
}

function detectSource(from: string, body: string): JobAlertSource {
  const f = from.toLowerCase();
  const b = body.toLowerCase();
  if (f.includes("linkedin")) return "linkedin_email";
  if (f.includes("indeed")) return "indeed_email";
  if (f.includes("handshake")) return "handshake_email";
  if (f.includes("glassdoor")) return "glassdoor_email";
  if (f.includes("wellfound") || f.includes("angellist")) return "wellfound_email";
  if (f.includes("simplify")) return "simplify_email";
  if (f.includes("google")) return "google_email";
  if (b.includes("career page") || b.includes("new opening")) return "company_career_alert";
  return "gmail_alert";
}

function detectRemoteType(text: string): ParsedJobAlertEmail["remoteType"] {
  const t = text.toLowerCase();
  if (/\bremote\b/.test(t)) return "remote";
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(t)) return "on-site";
  return "unknown";
}

export function parseJobAlertEmail(
  subject: string,
  body: string,
  from: string,
  emailId: string,
  receivedAt?: string
): ParsedJobAlertEmail | null {
  const urlMatch = body.match(/https?:\/\/[^\s<>"')]+/);
  const url = urlMatch?.[0]?.replace(/[.,;]+$/, "");
  if (isBlockedJobUrl(url)) return null;

  const titleFromSubject = subject
    .replace(/^.*—\s*/i, "")
    .replace(/^.*:\s*/, "")
    .split(/\s+at\s+/i)[0]
    ?.trim();
  const titleLine = body.match(/^([^\n]+)/m)?.[1]?.trim();
  const companyMatch =
    subject.match(/\bat\s+([^\n—]+)/i) ?? body.match(/\bat\s+([A-Za-z0-9 .&'-]+)/i);
  const locationMatch = body.match(
    /(?:location|where):\s*([^\n]+)/i
  ) ?? body.match(/(Remote|Hybrid|On[- ]?site)[^\n]*/i);

  const title = titleLine || titleFromSubject || "Unknown Role";
  const companyName = companyMatch?.[1]?.trim() ?? "Unknown Company";
  const location = locationMatch?.[1]?.trim();
  const shortDescription = body
    .split("\n")
    .filter((l) => l.trim().length > 20)
    .slice(0, 3)
    .join(" ")
    .slice(0, 500);

  return {
    companyName,
    title: title.trim(),
    url,
    location,
    remoteType: detectRemoteType(`${body} ${location ?? ""}`),
    source: detectSource(from, body),
    postedDate: receivedAt,
    shortDescription,
    rawEmailRef: emailId,
    dateFound: new Date().toISOString(),
    description: body,
  };
}
