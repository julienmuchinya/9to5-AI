import { describe, it, expect } from "vitest";
import { normalizeJob } from "./jobNormalizer";

describe("jobNormalizer", () => {
  it("normalizes similar intern titles", () => {
    const a = normalizeJob({
      title: "SWE Intern",
      companyName: "Acme",
      source: "gmail",
      description: "Required: Python",
    });
    const b = normalizeJob({
      title: "Software Developer Intern",
      companyName: "Acme",
      source: "gmail",
      description: "Required: Python",
    });
    expect(a.normalizedTitle).toBe("Software Engineer Intern");
    expect(b.normalizedTitle).toBe("Software Engineer Intern");
  });
});
