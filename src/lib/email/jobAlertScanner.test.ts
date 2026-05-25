import { describe, it, expect, beforeEach } from "vitest";
import { scanJobAlertEmails, getDefaultEmailFilterSettings } from "./jobAlertScanner";

describe("jobAlertScanner mock mode", () => {
  beforeEach(() => {
    process.env.MOCK_MODE = "true";
    delete process.env.GMAIL_REFRESH_TOKEN;
  });

  it("returns mock job alerts without Gmail API", async () => {
    const result = await scanJobAlertEmails({
      settings: getDefaultEmailFilterSettings(),
    });
    expect(result.source).toBe("mock");
    expect(result.alerts.length).toBeGreaterThan(0);
  });
});
