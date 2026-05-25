import { describe, it, expect } from "vitest";
import {
  checkBudgetBeforeAction,
  shouldAllowGeminiCall,
} from "./budgetGuard";
import { DEFAULT_USAGE_LIMITS } from "@/lib/constants";

const limits = {
  maxApplicationsPerDay: DEFAULT_USAGE_LIMITS.maxApplicationsPerDay,
  maxOutreachPerDay: DEFAULT_USAGE_LIMITS.maxOutreachPerDay,
  maxFollowupsPerDay: DEFAULT_USAGE_LIMITS.maxFollowupsPerDay,
  maxJobsAnalyzedPerDay: 2,
  maxCompaniesScannedPerDay: 2,
  maxAiCallsPerDay: DEFAULT_USAGE_LIMITS.maxAiCallsPerDay,
  maxDbWritesPerDay: DEFAULT_USAGE_LIMITS.maxDbWritesPerDay,
  maxDbReadsPerDay: DEFAULT_USAGE_LIMITS.maxDbReadsPerDay,
  maxCostPerDay: 0,
};

describe("budgetGuard Part 3", () => {
  it("blocks email scan when jobs analyzed at limit", () => {
    const counters = {
      applications: 0,
      outreach: 0,
      followups: 0,
      jobsAnalyzed: 2,
      companiesScanned: 0,
      aiCalls: 0,
      dbWrites: 0,
      dbReads: 0,
    };
    const r = checkBudgetBeforeAction(counters, limits, "jobsAnalyzed", "email_scan");
    expect(r.allowed).toBe(false);
  });

  it("blocks company scan at limit", () => {
    const counters = {
      applications: 0,
      outreach: 0,
      followups: 0,
      jobsAnalyzed: 0,
      companiesScanned: 2,
      aiCalls: 0,
      dbWrites: 0,
      dbReads: 0,
    };
    const r = checkBudgetBeforeAction(counters, limits, "companiesScanned", "company_scan");
    expect(r.allowed).toBe(false);
  });

  it("skips Gemini in mock mode", () => {
    const r = shouldAllowGeminiCall(
      { applications: 0, outreach: 0, followups: 0, jobsAnalyzed: 0, companiesScanned: 0, aiCalls: 0, dbWrites: 0, dbReads: 0 },
      limits,
      true,
      true,
      true
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("mock mode");
  });
});
