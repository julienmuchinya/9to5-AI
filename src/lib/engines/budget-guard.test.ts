import { describe, it, expect } from "vitest";
import { canIncrement, getBudgetLevel } from "./budget-guard";

describe("budget guard", () => {
  it("stops at 100%", () => {
    const r = canIncrement(
      { applications: 50, outreach: 0, followups: 0, jobsAnalyzed: 0, companiesScanned: 0, aiCalls: 0, dbWrites: 0, dbReads: 0 },
      { maxApplicationsPerDay: 50, maxOutreachPerDay: 10, maxFollowupsPerDay: 10, maxJobsAnalyzedPerDay: 90, maxCompaniesScannedPerDay: 80, maxAiCallsPerDay: 50, maxDbWritesPerDay: 1000, maxDbReadsPerDay: 5000, maxCostPerDay: 0 },
      "applications"
    );
    expect(r.allowed).toBe(false);
    expect(r.level).toBe("stopped");
  });

  it("warns at 80%", () => {
    expect(getBudgetLevel(85)).toBe("warn");
  });
});
