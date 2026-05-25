import { NextResponse } from "next/server";
import { getDefaultStore } from "@/lib/store/local-store";
import { DEFAULT_USAGE_LIMITS } from "@/lib/constants";

export async function GET() {
  const store = getDefaultStore();
  const limits = store.agent_usage_limits;

  return NextResponse.json({
    ok: true,
    today: {
      applications: limits.applications_today,
      outreach: limits.outreach_today,
      jobsAnalyzed: limits.jobs_analyzed_today,
      aiCalls: limits.ai_calls_today,
      emailsScanned: limits.emails_scanned_today ?? 0,
      companiesScanned: limits.companies_scanned_today ?? 0,
      jobsSaved: limits.jobs_saved_today ?? 0,
      duplicatesSkipped: limits.duplicates_skipped_today ?? 0,
      cacheHits: limits.cache_hits_today ?? 0,
      estimatedCost: limits.estimated_cost_today ?? 0,
    },
    caps: {
      maxApplicationsPerDay: limits.maxApplicationsPerDay,
      maxOutreachPerDay: limits.maxOutreachPerDay,
      maxJobsAnalyzedPerDay: limits.maxJobsAnalyzedPerDay,
      maxCompaniesScannedPerDay: limits.maxCompaniesScannedPerDay,
      maxAiCallsPerDay: limits.maxAiCallsPerDay,
      maxCostPerDay: limits.maxCostPerDay ?? DEFAULT_USAGE_LIMITS.maxCostPerDay,
    },
    costLimitZero: (limits.maxCostPerDay ?? 0) === 0,
  });
}
