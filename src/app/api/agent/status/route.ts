import { NextResponse } from "next/server";
import { getDefaultStore } from "@/lib/store/default-store";
import { evaluateLiveRunGuard } from "@/lib/agent/liveRunGuard";
import { isMockModeEnv } from "@/lib/config/env";
import { detectRuntimeMode } from "@/lib/config/runtimeMode";

export async function GET() {
  const store = getDefaultStore();
  const guard = evaluateLiveRunGuard({ store });
  const lastRun = store.agent_runs[0];

  return NextResponse.json({
    ok: true,
    runtimeMode: detectRuntimeMode(),
    mockMode: isMockModeEnv(),
    liveAgentAllowed: guard.allowed,
    blockReasons: guard.reasons,
    emergencyStop: store.autopilot_settings.emergency_stop,
    autopilotEnabled: store.autopilot_settings.auto_apply_enabled,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          started_at: lastRun.started_at,
          summary: lastRun.summary,
          mock_mode: lastRun.mock_mode,
        }
      : null,
  });
}
