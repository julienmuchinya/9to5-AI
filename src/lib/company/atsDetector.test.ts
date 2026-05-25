import { describe, it, expect } from "vitest";
import { detectAtsFromUrl } from "./atsDetector";

describe("atsDetector", () => {
  it("detects Greenhouse boards", () => {
    const r = detectAtsFromUrl("https://boards.greenhouse.io/acme/jobs/123");
    expect(r.platform).toBe("greenhouse");
    expect(r.safeToScan).toBe(true);
  });

  it("blocks LinkedIn URLs", () => {
    const r = detectAtsFromUrl("https://www.linkedin.com/jobs/view/1");
    expect(r.safeToScan).toBe(false);
    expect(r.reason).toBe("BLOCKED_WEBSITE");
  });
});
