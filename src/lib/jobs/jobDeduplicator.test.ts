import { describe, it, expect } from "vitest";
import { checkDuplicate } from "./jobDeduplicator";
import { normalizeJob } from "./jobNormalizer";

describe("jobDeduplicator", () => {
  it("detects duplicate by idempotency key", () => {
    const job = normalizeJob({
      title: "Software Engineer Intern",
      companyName: "Acme Tech",
      url: "https://boards.greenhouse.io/acme/jobs/123",
      source: "gmail_alert",
      description: "Python role",
    });
    const key = checkDuplicate(job, []).idempotencyKey;
    const existing = [
      {
        id: "j1",
        idempotency_key: key,
        company_name: "Acme Tech",
        title: "Software Engineer Intern",
      },
    ];
    const dup = checkDuplicate(job, existing);
    expect(dup.isDuplicate).toBe(true);
    expect(dup.matchType).toBe("idempotency_key");
  });
});
