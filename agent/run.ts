#!/usr/bin/env npx tsx
/**
 * 9to5 AI cloud agent entrypoint.
 * Run locally: npm run agent:mock
 * Run in CI: GitHub Actions daily-agent.yml
 */
import { runAgentPipeline } from "./pipeline";
import { evaluateCloudRunnerGuard } from "../src/lib/agent/cloudRunnerGuard";
import { isMockModeEnv } from "../src/lib/config/env";

async function main() {
  const guard = evaluateCloudRunnerGuard({
    mode: process.env.MOCK_MODE === "true" ? "mock" : "live",
    dryRun: process.env.DRY_RUN === "true",
    liveAgentEnabled: process.env.LIVE_AGENT_ENABLED === "true",
  });

  const mock = guard.effectiveMode === "mock" || isMockModeEnv();
  if (mock) {
    process.env.MOCK_MODE = "true";
    process.env.NEXT_PUBLIC_MOCK_MODE = "true";
  }

  if (guard.dryRun && guard.effectiveMode === "live") {
    console.log("[9to5 AI] Live dry run — exiting safely", guard.reasons);
    return;
  }

  if (!guard.allowed && guard.effectiveMode === "live") {
    console.error("[9to5 AI] Live run blocked:", guard.reasons.join("; "));
    process.exit(1);
  }

  console.log(`[9to5 AI] Starting agent (mock=${mock}, mode=${guard.effectiveMode})...`);
  // Email scanning needs Gmail OAuth; skip it automatically until that is set up.
  const gmailReady = Boolean(
    (process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID) &&
      process.env.GMAIL_REFRESH_TOKEN
  );
  const scanEmail = process.env.SCAN_EMAIL !== "false" && (mock || gmailReady);
  if (!mock && process.env.SCAN_EMAIL !== "false" && !gmailReady) {
    console.log("[9to5 AI] Gmail not configured — skipping email scan this run");
  }

  const { runId, summary } = await runAgentPipeline(undefined, {
    // This process is the trusted runner, so it vouches with its own secret.
    agentSecret: process.env.AGENT_SECRET ?? process.env.AGENT_CRON_SECRET ?? null,
    scanEmail,
    scanCompanies: process.env.SCAN_COMPANIES !== "false",
  });
  console.log(`[9to5 AI] Run ${runId} complete:`, JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("[9to5 AI] Agent failed:", err);
  process.exit(1);
});
