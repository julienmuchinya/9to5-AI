import type { BudgetCounters, UsageLimits } from "../types";

export type BudgetLevel = "ok" | "warn" | "high_risk" | "stopped";

export function getUsagePercent(current: number, max: number): number {
  if (max <= 0) return 100;
  return Math.round((current / max) * 100);
}

export function getBudgetLevel(percent: number): BudgetLevel {
  if (percent >= 100) return "stopped";
  if (percent >= 90) return "high_risk";
  if (percent >= 80) return "warn";
  return "ok";
}

export function canIncrement(
  counters: BudgetCounters,
  limits: UsageLimits,
  metric: keyof BudgetCounters
): { allowed: boolean; level: BudgetLevel; percent: number } {
  const maxMap: Record<keyof BudgetCounters, keyof UsageLimits> = {
    applications: "maxApplicationsPerDay",
    outreach: "maxOutreachPerDay",
    followups: "maxFollowupsPerDay",
    jobsAnalyzed: "maxJobsAnalyzedPerDay",
    companiesScanned: "maxCompaniesScannedPerDay",
    aiCalls: "maxAiCallsPerDay",
    dbWrites: "maxDbWritesPerDay",
    dbReads: "maxDbReadsPerDay",
  };

  const max = limits[maxMap[metric]] as number;
  const current = counters[metric];
  const percent = getUsagePercent(current, max);
  const level = getBudgetLevel(percent);

  return { allowed: level !== "stopped", level, percent };
}

export function detectCostRisk(action: string): boolean {
  const paidPatterns = [/stripe/i, /paid api/i, /premium/i, /purchase/i, /subscribe/i];
  return paidPatterns.some((p) => p.test(action));
}
