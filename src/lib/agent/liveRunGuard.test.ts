import { describe, it, expect, afterEach } from "vitest";
import { evaluateLiveRunGuard } from "./liveRunGuard";
import { getDefaultStore } from "@/lib/store/local-store";

describe("liveRunGuard", () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
  });

  it("allows mock mode runs", () => {
    process.env.NEXT_PUBLIC_MOCK_MODE = "true";
    const store = getDefaultStore();
    const result = evaluateLiveRunGuard({ store });
    expect(result.allowed).toBe(true);
    expect(result.mockMode).toBe(true);
  });

  it("blocks when emergency stop in live mode", () => {
    process.env.NEXT_PUBLIC_MOCK_MODE = "false";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.AGENT_SECRET = "test-secret-123";
    const store = getDefaultStore();
    store.autopilot_settings.mock_mode = false;
    store.autopilot_settings.emergency_stop = true;
    const result = evaluateLiveRunGuard({ store });
    expect(result.allowed).toBe(false);
    expect(result.reasons.some((r) => r.code === "EMERGENCY_STOP")).toBe(true);
  });
});
