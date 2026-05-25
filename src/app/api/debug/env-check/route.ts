import { NextResponse } from "next/server";
import { validateAllEnv, getPublicEnvSnapshot, isMockModeEnv } from "@/lib/config/env";
import { detectRuntimeMode } from "@/lib/config/runtimeMode";

/** Safe env diagnostics — never returns server secrets */
export async function GET() {
  if (process.env.NODE_ENV === "production" && !isMockModeEnv()) {
    return NextResponse.json({ ok: false, error: "Disabled in production live mode" }, { status: 403 });
  }

  const issues = validateAllEnv();
  return NextResponse.json({
    ok: issues.length === 0,
    runtimeMode: detectRuntimeMode(),
    publicEnv: getPublicEnvSnapshot(),
    issues: issues.map((i) => ({
      key: i.key,
      message: i.message,
      requiredFor: i.requiredFor,
    })),
  });
}
