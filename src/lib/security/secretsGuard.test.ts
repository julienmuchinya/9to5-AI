import { describe, it, expect } from "vitest";
import { safeClientPayload } from "./secretsGuard";

describe("secretsGuard", () => {
  it("never exposes service role in client payload", () => {
    const safe = safeClientPayload({
      mockMode: true,
      SUPABASE_SERVICE_ROLE_KEY: "secret-key",
    });
    expect(safe.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(safe.mockMode).toBe(true);
  });
});
