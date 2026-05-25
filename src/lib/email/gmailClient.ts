import { isMockModeEnv } from "@/lib/config/env";
import type { RawEmailMessage } from "./emailFilters";

export function isGmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_REFRESH_TOKEN &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET
  );
}

export function isGmailMockMode(): boolean {
  return isMockModeEnv() || !isGmailConfigured();
}

/**
 * Fetch job-alert emails via Gmail API (live only).
 * Never reads all personal mail — caller must pass a scoped search query.
 */
export async function fetchGmailMessages(
  searchQuery: string,
  maxResults: number
): Promise<RawEmailMessage[]> {
  if (isGmailMockMode()) return [];

  // Live Gmail API integration placeholder — returns empty until OAuth flow completes.
  // Part 3: no unscoped inbox reads; searchQuery must be job-alert specific.
  void searchQuery;
  void maxResults;
  return [];
}

export function buildJobAlertSearchQuery(lookbackDays: number, unreadOnly: boolean): string {
  const parts = [
    "subject:(job OR intern OR opening OR alert OR match)",
    `newer_than:${lookbackDays}d`,
  ];
  if (unreadOnly) parts.push("is:unread");
  return parts.join(" ");
}
