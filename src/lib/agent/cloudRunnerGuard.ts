import { isMockModeEnv } from "@/lib/config/env";
import { allowsScheduledCloudRunner, detectRuntimeMode } from "@/lib/config/runtimeMode";

export interface CloudRunnerInput {
  mode?: "mock" | "live";
  dryRun?: boolean;
  liveAgentEnabled?: boolean;
}

export function evaluateCloudRunnerGuard(input: CloudRunnerInput = {}): {
  allowed: boolean;
  effectiveMode: "mock" | "live";
  dryRun: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const envLive = process.env.LIVE_AGENT_ENABLED === "true";
  const requestedLive = input.mode === "live" || envLive;
  const dryRun = input.dryRun !== false;

  if (isMockModeEnv() || !requestedLive) {
    return { allowed: true, effectiveMode: "mock", dryRun: true, reasons: [] };
  }

  if (!envLive && input.liveAgentEnabled !== true) {
    reasons.push("LIVE_AGENT_ENABLED must be true for live cloud runs");
  }

  if (!process.env.AGENT_SECRET && !process.env.AGENT_CRON_SECRET) {
    reasons.push("AGENT_SECRET is required for live cloud runs");
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    reasons.push("NEXT_PUBLIC_SUPABASE_URL required for live mode");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    reasons.push("SUPABASE_SERVICE_ROLE_KEY required for live mode");
  }
  if (!process.env.AGENT_USER_ID) {
    reasons.push("AGENT_USER_ID required for live Supabase persistence");
  }

  const runtime = detectRuntimeMode();
  if (!allowsScheduledCloudRunner() && runtime === "LIVE_LOCAL") {
    reasons.push("Scheduled production runner only allowed in LIVE_PRODUCTION");
  }

  return {
    allowed: reasons.length === 0,
    effectiveMode: reasons.length === 0 ? "live" : "mock",
    dryRun: dryRun || reasons.length > 0,
    reasons,
  };
}
