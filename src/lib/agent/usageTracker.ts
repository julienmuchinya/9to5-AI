import type { BudgetCounters } from "@/lib/types";
import type { LocalStore } from "@/lib/store/local-store";

export interface UsageSnapshot {
  emailsScanned: number;
  companiesScanned: number;
  jobsFound: number;
  jobsSaved: number;
  duplicatesSkipped: number;
  jobsAnalyzed: number;
  aiCallsUsed: number;
  cacheHits: number;
  dbReads: number;
  dbWrites: number;
  estimatedCostUsd: number;
}

export function createUsageCounters(store: LocalStore): BudgetCounters {
  const limits = store.agent_usage_limits;
  return {
    applications: limits.applications_today,
    outreach: limits.outreach_today,
    followups: 0,
    jobsAnalyzed: limits.jobs_analyzed_today,
    companiesScanned: limits.companies_scanned_today ?? 0,
    aiCalls: limits.ai_calls_today,
    dbWrites: limits.db_writes_today ?? 0,
    dbReads: limits.db_reads_today ?? 0,
  };
}

export function applyUsageCounters(
  store: LocalStore,
  counters: BudgetCounters,
  snapshot: Partial<UsageSnapshot>
): void {
  store.agent_usage_limits = {
    ...store.agent_usage_limits,
    applications_today: counters.applications,
    outreach_today: counters.outreach,
    jobs_analyzed_today: counters.jobsAnalyzed,
    companies_scanned_today: counters.companiesScanned,
    ai_calls_today: counters.aiCalls,
    db_writes_today: counters.dbWrites,
    db_reads_today: counters.dbReads,
    emails_scanned_today: snapshot.emailsScanned ?? store.agent_usage_limits.emails_scanned_today ?? 0,
    jobs_saved_today: snapshot.jobsSaved ?? store.agent_usage_limits.jobs_saved_today ?? 0,
    duplicates_skipped_today: snapshot.duplicatesSkipped ?? store.agent_usage_limits.duplicates_skipped_today ?? 0,
    cache_hits_today: snapshot.cacheHits ?? store.agent_usage_limits.cache_hits_today ?? 0,
    estimated_cost_today: snapshot.estimatedCostUsd ?? 0,
  };
}

export function emptyUsageSnapshot(): UsageSnapshot {
  return {
    emailsScanned: 0,
    companiesScanned: 0,
    jobsFound: 0,
    jobsSaved: 0,
    duplicatesSkipped: 0,
    jobsAnalyzed: 0,
    aiCallsUsed: 0,
    cacheHits: 0,
    dbReads: 0,
    dbWrites: 0,
    estimatedCostUsd: 0,
  };
}
