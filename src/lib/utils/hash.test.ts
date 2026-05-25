import { describe, it, expect } from "vitest";
import { normalizeJobKey, hashJobDescription } from "./hash";

describe("hash utils", () => {
  it("produces stable idempotency keys", () => {
    const a = normalizeJobKey("Acme", "SWE Intern", "https://jobs.com/1", "gmail");
    const b = normalizeJobKey("Acme", "SWE Intern", "https://jobs.com/1", "gmail");
    expect(a).toBe(b);
  });

  it("hashes job descriptions", () => {
    expect(hashJobDescription("Hello  World")).toBe(hashJobDescription("hello world"));
  });
});
