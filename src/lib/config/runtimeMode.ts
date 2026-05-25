import { isMockModeEnv } from "./env";

export type RuntimeMode = "MOCK_LOCAL" | "LIVE_LOCAL" | "LIVE_PRODUCTION";

export function detectRuntimeMode(): RuntimeMode {
  if (isMockModeEnv()) return "MOCK_LOCAL";

  const vercelEnv = process.env.VERCEL_ENV;
  const isProduction =
    vercelEnv === "production" ||
    (process.env.NODE_ENV === "production" && vercelEnv !== "preview");

  return isProduction ? "LIVE_PRODUCTION" : "LIVE_LOCAL";
}

export function usesSupabase(): boolean {
  return detectRuntimeMode() !== "MOCK_LOCAL";
}

export function usesExternalApis(): boolean {
  return detectRuntimeMode() !== "MOCK_LOCAL";
}

export function allowsScheduledCloudRunner(): boolean {
  return detectRuntimeMode() === "LIVE_PRODUCTION";
}

export function runtimeModeLabel(mode: RuntimeMode): string {
  switch (mode) {
    case "MOCK_LOCAL":
      return "Mock Mode (local demo)";
    case "LIVE_LOCAL":
      return "Live Mode (local)";
    case "LIVE_PRODUCTION":
      return "Live Mode (production)";
  }
}
