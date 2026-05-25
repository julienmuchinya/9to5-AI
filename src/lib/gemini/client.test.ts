import { describe, it, expect, afterEach } from "vitest";
import { isMockMode, usesRealGeminiApi } from "./client";

describe("gemini client", () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
  });

  it("does not use real API in mock mode", () => {
    process.env.NEXT_PUBLIC_MOCK_MODE = "true";
    process.env.GEMINI_API_KEY = "test-key";
    expect(isMockMode()).toBe(true);
    expect(usesRealGeminiApi()).toBe(false);
  });
});
