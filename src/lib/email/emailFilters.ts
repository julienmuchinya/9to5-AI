export const ALLOWED_JOB_ALERT_SENDERS = [
  "jobs-noreply@linkedin.com",
  "jobalerts-noreply@linkedin.com",
  "noreply@indeed.com",
  "alerts@indeed.com",
  "noreply@joinhandshake.com",
  "noreply@glassdoor.com",
  "alerts@wellfound.com",
  "noreply@simplify.jobs",
  "noreply@google.com",
  "jobs@google.com",
];

export const BLOCKED_SENDER_PATTERNS = [
  /newsletter@/i,
  /marketing@/i,
  /promo@/i,
  /unsubscribe/i,
];

export const BLOCKED_URL_PATTERNS = [
  /linkedin\.com\/jobs/i,
  /indeed\.com\/viewjob/i,
  /indeed\.com\/rc\/clk/i,
];

export interface EmailFilterSettings {
  allowedSenders: string[];
  blockedSenders: string[];
  allowedKeywords: string[];
  blockedKeywords: string[];
  scanUnreadOnly: boolean;
  lookbackDays: number;
  maxEmailsPerRun: number;
}

export interface RawEmailMessage {
  id: string;
  subject: string;
  body: string;
  from: string;
  receivedAt: string;
  isUnread: boolean;
}

export function isAllowedSender(from: string, settings: EmailFilterSettings): boolean {
  const fromLower = from.toLowerCase();
  if (settings.blockedSenders.some((s) => fromLower.includes(s.toLowerCase()))) {
    return false;
  }
  if (BLOCKED_SENDER_PATTERNS.some((p) => p.test(fromLower))) {
    return false;
  }
  const allowed = [
    ...ALLOWED_JOB_ALERT_SENDERS,
    ...settings.allowedSenders.filter(Boolean),
  ];
  return allowed.some((s) => fromLower.includes(s.toLowerCase()));
}

export function passesKeywordFilters(
  subject: string,
  body: string,
  settings: EmailFilterSettings
): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  if (settings.blockedKeywords.some((k) => k && text.includes(k.toLowerCase()))) {
    return false;
  }
  if (settings.allowedKeywords.length === 0) return true;
  return settings.allowedKeywords.some((k) => k && text.includes(k.toLowerCase()));
}

export function isWithinLookback(receivedAt: string, lookbackDays: number): boolean {
  const received = new Date(receivedAt).getTime();
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return received >= cutoff;
}

export function filterJobAlertEmails(
  emails: RawEmailMessage[],
  settings: EmailFilterSettings
): RawEmailMessage[] {
  return emails
    .filter((e) => isWithinLookback(e.receivedAt, settings.lookbackDays))
    .filter((e) => !settings.scanUnreadOnly || e.isUnread)
    .filter((e) => isAllowedSender(e.from, settings))
    .filter((e) => passesKeywordFilters(e.subject, e.body, settings))
    .slice(0, settings.maxEmailsPerRun);
}

export function isBlockedJobUrl(url: string | undefined): boolean {
  if (!url) return false;
  return BLOCKED_URL_PATTERNS.some((p) => p.test(url));
}
