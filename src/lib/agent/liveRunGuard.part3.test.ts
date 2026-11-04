import { describe, it, expect, beforeEach } from "vitest";
import { evaluateLiveRunGuard } from "./liveRunGuard";
import { getDefaultStore } from "@/lib/store/default-store";

describe("liveRunGuard Part 3", () => {
  beforeEach(() => {
    delete process.env.MOCK_MODE;
    delete process.env.NEXT_PUBLIC_MOCK_MODE;
    process.env.LIVE_AGENT_ENABLED = "true";
  });

  it("blocks live runner when setup incomplete", () => {
    process.env.AGENT_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const store = getDefaultStore();
    store.autopilot_settings.mock_mode = false;
    store.profile.full_name = "";
    const guard = evaluateLiveRunGuard({
      store,
      agentSecretHeader: "test-secret",
      setupContext: { databaseReachable: false, tablesExist: false },
    });
    expect(guard.allowed).toBe(false);
    expect(guard.reasons.some((r) => r.code.startsWith("SETUP_"))).toBe(true);
  });
});
