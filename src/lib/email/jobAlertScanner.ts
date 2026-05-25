import {
  MOCK_JOB_ALERT,
  MOCK_JOB_ALERTS_EXTRA,
} from "@/lib/mock/data";
import {
  buildJobAlertSearchQuery,
  fetchGmailMessages,
  isGmailMockMode,
} from "./gmailClient";
import {
  filterJobAlertEmails,
  type EmailFilterSettings,
  type RawEmailMessage,
} from "./emailFilters";
import { parseJobAlertEmail, type ParsedJobAlertEmail } from "./jobAlertParser";

export type { ParsedJobAlertEmail } from "./jobAlertParser";

export interface JobAlertScanOptions {
  settings: EmailFilterSettings;
  markAsRead?: boolean;
}

export function getDefaultEmailFilterSettings(
  overrides?: Partial<EmailFilterSettings>
): EmailFilterSettings {
  return {
    allowedSenders: [],
    blockedSenders: [],
    allowedKeywords: ["intern", "software", "engineer", "developer"],
    blockedKeywords: ["senior staff", "principal", "10+ years"],
    scanUnreadOnly: false,
    lookbackDays: 7,
    maxEmailsPerRun: 25,
    ...overrides,
  };
}

function mockRawEmails(): RawEmailMessage[] {
  const alerts = [MOCK_JOB_ALERT, ...MOCK_JOB_ALERTS_EXTRA];
  return alerts.map((a, i) => ({
    id: `mock-email-${i}`,
    subject: a.subject,
    body: a.body,
    from: a.from,
    receivedAt: new Date(Date.now() - i * 3600000).toISOString(),
    isUnread: true,
  }));
}

export async function scanJobAlertEmails(
  options: JobAlertScanOptions
): Promise<{ alerts: ParsedJobAlertEmail[]; scanned: number; source: "mock" | "gmail" }> {
  let raw: RawEmailMessage[] = [];

  if (isGmailMockMode()) {
    raw = mockRawEmails();
  } else {
    const query = buildJobAlertSearchQuery(
      options.settings.lookbackDays,
      options.settings.scanUnreadOnly
    );
    raw = await fetchGmailMessages(query, options.settings.maxEmailsPerRun);
  }

  const filtered = filterJobAlertEmails(raw, options.settings);
  const alerts: ParsedJobAlertEmail[] = [];

  for (const email of filtered) {
    const parsed = parseJobAlertEmail(
      email.subject,
      email.body,
      email.from,
      email.id,
      email.receivedAt
    );
    if (parsed) alerts.push(parsed);
  }

  // Part 3: never mark as read unless explicitly enabled (default false)
  void options.markAsRead;

  return {
    alerts,
    scanned: filtered.length,
    source: isGmailMockMode() ? "mock" : "gmail",
  };
}

/** @deprecated use scanJobAlertEmails */
export async function fetchJobAlertEmails(
  settings?: Partial<EmailFilterSettings>
): Promise<ParsedJobAlertEmail[]> {
  const result = await scanJobAlertEmails({
    settings: getDefaultEmailFilterSettings(settings),
  });
  return result.alerts;
}

export { isGmailMockMode as isMockMode } from "./gmailClient";
