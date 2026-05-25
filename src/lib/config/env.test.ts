import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isMockModeEnv,
  validateLiveSupabaseEnv,
  stripServerSecrets,
  SERVER_ONLY_KEYS,
} from "./env";

describe("env validation", () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
  });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_MODE = "true";
    process.env.MOCK_MODE = "true";
  });

  it("detects mock mode", () => {
    expect(isMockModeEnv()).toBe(true);
  });

  it("skips supabase validation in mock mode", () => {
    expect(validateLiveSupabaseEnv()).toHaveLength(0);
  });

  it("strips server-only keys", () => {
    const payload = {
      NEXT_PUBLIC_MOCK_MODE: "true",
      SUPABASE_SERVICE_ROLE_KEY: "secret",
      GEMINI_API_KEY: "key",
    };
    const safe = stripServerSecrets(payload);
    expect(safe.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(safe.GEMINI_API_KEY).toBeUndefined();
    expect(SERVER_ONLY_KEYS).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
