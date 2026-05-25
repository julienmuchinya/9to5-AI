import { describe, it, expect } from "vitest";
import {
  filterJobAlertEmails,
  isAllowedSender,
  passesKeywordFilters,
} from "./emailFilters";
import type { RawEmailMessage } from "./emailFilters";

describe("emailFilters", () => {
  const settings = {
    allowedSenders: [],
    blockedSenders: ["spam@bad.com"],
    allowedKeywords: ["intern"],
    blockedKeywords: ["senior"],
    scanUnreadOnly: false,
    lookbackDays: 7,
    maxEmailsPerRun: 10,
  };

  it("allows known job alert senders", () => {
    expect(isAllowedSender("jobalerts-noreply@linkedin.com", settings)).toBe(true);
    expect(isAllowedSender("spam@bad.com", settings)).toBe(false);
  });

  it("filters blocked keywords", () => {
    expect(passesKeywordFilters("Senior role", "10+ years required", settings)).toBe(false);
    expect(passesKeywordFilters("Intern role", "software intern", settings)).toBe(true);
  });

  it("limits max emails per run", () => {
    const emails: RawEmailMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: `e${i}`,
      subject: `Intern role ${i}`,
      body: "software intern job",
      from: "jobalerts-noreply@linkedin.com",
      receivedAt: new Date().toISOString(),
      isUnread: true,
    }));
    expect(filterJobAlertEmails(emails, settings).length).toBe(10);
  });
});
