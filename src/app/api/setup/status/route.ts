import { NextResponse } from "next/server";
import { getDefaultStore } from "@/lib/store/default-store";
import { validateSetupForStore } from "@/lib/setup/setupValidator";
import { getPublicEnvSnapshot } from "@/lib/config/env";
import { detectRuntimeMode } from "@/lib/config/runtimeMode";

export async function GET() {
  try {
    const store = getDefaultStore();
    const validation = await validateSetupForStore(store);
    return NextResponse.json({
      ok: true,
      runtimeMode: detectRuntimeMode(),
      env: getPublicEnvSnapshot(),
      setupComplete: validation.setupComplete,
      mockMode: validation.mockMode,
      checklist: validation.checklist,
      envIssues: validation.envIssues.map((i) => ({
        key: i.key,
        message: i.message,
        requiredFor: i.requiredFor,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Setup status failed",
      },
      { status: 500 }
    );
  }
}
