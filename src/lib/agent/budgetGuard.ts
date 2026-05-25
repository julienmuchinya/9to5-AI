import {
  canIncrement,
  detectCostRisk,
  getBudgetLevel,
  getUsagePercent,
  type BudgetLevel,
} from "@/lib/engines/budget-guard";
import type { BudgetCounters, UsageLimits } from "@/lib/types";

export type { BudgetLevel };

export interface BudgetCheckResult {
  allowed: boolean;
  level: BudgetLevel;
  percent: number;
  metric: string;
}

export function checkBudgetBeforeAction(
  counters: BudgetCounters,
  limits: UsageLimits,
  metric: keyof BudgetCounters,
  actionLabel: string
): BudgetCheckResult {
  const result = canIncrement(counters, limits, metric);
  return {
    allowed: result.allowed,
    level: result.level,
    percent: result.percent,
    metric: `${metric}:${actionLabel}`,
  };
}

export function checkCostBudget(limits: UsageLimits): BudgetCheckResult {
  const max = limits.maxCostPerDay ?? 0;
  const allowed = max === 0 ? false : true;
  // Part 3: estimated cost limit stays $0 — block paid actions
  if (max <= 0) {
    return { allowed: false, level: "stopped", percent: 100, metric: "cost:zero_cap" };
  }
  return { allowed, level: "ok", percent: 0, metric: "cost" };
}

export function shouldAllowGeminiCall(
  counters: BudgetCounters,
  limits: UsageLimits,
  mockMode: boolean,
  geminiEnabled: boolean,
  hasApiKey: boolean
): { allowed: boolean; reason: string } {
  if (mockMode) {
    return { allowed: false, reason: "Gemini skipped because mock mode is active" };
  }
  if (!geminiEnabled) {
    return { allowed: false, reason: "Gemini disabled in settings" };
  }
  if (!hasApiKey) {
    return { allowed: false, reason: "Gemini API key not configured" };
  }
  const cost = checkCostBudget(limits);
  if (!cost.allowed) {
    return { allowed: false, reason: "Cost limit is $0 — Gemini blocked" };
  }
  const ai = canIncrement(counters, limits, "aiCalls");
  if (!ai.allowed) {
    return { allowed: false, reason: "AI daily limit reached" };
  }
  if (detectCostRisk("gemini")) {
    return { allowed: false, reason: "Cost risk detected for Gemini" };
  }
  return { allowed: true, reason: "ok" };
}

export { canIncrement, detectCostRisk, getBudgetLevel, getUsagePercent };
