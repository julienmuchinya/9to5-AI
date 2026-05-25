import { NextResponse } from "next/server";
import { getDefaultStore } from "@/lib/store/local-store";
import { isMockModeEnv } from "@/lib/config/env";
import { evaluateLiveRunGuard } from "@/lib/agent/liveRunGuard";
import {
  scanJobAlertEmails,
  getDefaultEmailFilterSettings,
} from "@/lib/email/jobAlertScanner";
import { checkBudgetBeforeAction } from "@/lib/agent/budgetGuard";
import { createUsageCounters } from "@/lib/agent/usageTracker";
import { DEFAULT_USAGE_LIMITS } from "@/lib/constants";

export async function POST(request: Request) {
  try {
    const store = getDefaultStore();
    try {
      const body = await request.json();
      if (body?.store) Object.assign(store, body.store);
    } catch {
      // no body
    }

    if (store.autopilot_settings.emergency_stop) {
      return NextResponse.json({ ok: false, error: "Emergency stop enabled" }, { status: 403 });
    }

    const mockMode = isMockModeEnv() || store.autopilot_settings.mock_mode;
    if (!mockMode) {
      const authHeader = request.headers.get("authorization");
      const agentSecret = authHeader?.replace(/^Bearer\s+/i, "") ?? null;
      const guard = evaluateLiveRunGuard({ store, agentSecretHeader: agentSecret });
      if (!guard.allowed) {
        return NextResponse.json(
          { ok: false, error: "Live scan blocked", reasons: guard.reasons },
          { status: 403 }
        );
      }
    }

    const settings = store.autopilot_settings;
    const counters = createUsageCounters(store);
    const limits = {
      ...DEFAULT_USAGE_LIMITS,
      maxJobsAnalyzedPerDay: store.agent_usage_limits.maxJobsAnalyzedPerDay,
      maxCompaniesScannedPerDay: store.agent_usage_limits.maxCompaniesScannedPerDay,
      maxAiCallsPerDay: store.agent_usage_limits.maxAiCallsPerDay,
      maxDbWritesPerDay: store.agent_usage_limits.maxDbWritesPerDay,
      maxDbReadsPerDay: store.agent_usage_limits.maxDbReadsPerDay,
      maxApplicationsPerDay: store.agent_usage_limits.maxApplicationsPerDay,
      maxOutreachPerDay: store.agent_usage_limits.maxOutreachPerDay,
      maxFollowupsPerDay: store.agent_usage_limits.maxFollowupsPerDay,
      maxCostPerDay: store.agent_usage_limits.maxCostPerDay ?? 0,
    };

    const budget = checkBudgetBeforeAction(counters, limits, "jobsAnalyzed", "email_scan");
    if (!budget.allowed) {
      return NextResponse.json(
        { ok: false, error: "Budget limit reached", budget },
        { status: 429 }
      );
    }

    const emailSettings = getDefaultEmailFilterSettings({
      allowedSenders: settings.allowed_job_alert_senders,
      blockedSenders: settings.blocked_job_alert_senders,
      allowedKeywords: settings.allowed_role_keywords,
      blockedKeywords: settings.blocked_keywords,
      scanUnreadOnly: settings.scan_unread_only,
      lookbackDays: settings.scan_email_lookback_days,
      maxEmailsPerRun: settings.max_job_alert_emails_per_run,
    });

    const result = await scanJobAlertEmails({
      settings: emailSettings,
      markAsRead: settings.mark_processed_emails,
    });

    return NextResponse.json({
      ok: true,
      mock: mockMode,
      scanned: result.scanned,
      alerts: result.alerts,
      source: result.source,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 }
    );
  }
}
