import { NextResponse } from "next/server";
import { runAgentPipeline } from "../../../../../agent/pipeline";
import { getDefaultStore } from "@/lib/store/default-store";
import { isMockModeEnv } from "@/lib/config/env";
import { evaluateLiveRunGuard } from "@/lib/agent/liveRunGuard";
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const agentSecret = authHeader?.replace(/^Bearer\s+/i, "") ?? null;

    let store = getDefaultStore();
    try {
      const body = await request.json();
      if (body?.store) store = body.store;
    } catch {
      // no body
    }

    if (!isMockModeEnv()) {
      const expected = process.env.AGENT_SECRET ?? process.env.AGENT_CRON_SECRET;
      if (!agentSecret || agentSecret !== expected) {
        return NextResponse.json(
          { ok: false, error: "Missing or invalid AGENT_SECRET (Bearer token)" },
          { status: 401 }
        );
      }
      const guard = evaluateLiveRunGuard({ store, agentSecretHeader: agentSecret });
      if (!guard.allowed) {
        return NextResponse.json(
          {
            ok: false,
            error: "Live agent run blocked",
            reasons: guard.reasons,
          },
          { status: 403 }
        );
      }
    }

    const { store: updated, summary, runId } = await runAgentPipeline(store, {
      agentSecret,
    });

    return NextResponse.json({
      ok: true,
      runId,
      summary,
      store: updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Agent run failed",
      },
      { status: 500 }
    );
  }
}
