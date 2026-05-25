import { describe, it, expect } from "vitest";
import { buildJobIdempotencyKey, buildUrlDedupeKey } from "./idempotency";

describe("idempotency", () => {
  it("builds stable job keys", () => {
    const k1 = buildJobIdempotencyKey({
      companyName: "Acme",
      title: "Intern",
      url: "https://example.com/job/",
      source: "gmail",
    });
    const k2 = buildJobIdempotencyKey({
      companyName: "acme",
      title: "intern",
      url: "https://example.com/job",
      source: "gmail",
    });
    expect(k1).toBe(k2);
  });

  it("normalizes URL dedupe keys", () => {
    expect(buildUrlDedupeKey("https://Example.com/JOB/")).toBe(
      buildUrlDedupeKey("https://example.com/job")
    );
  });
});
