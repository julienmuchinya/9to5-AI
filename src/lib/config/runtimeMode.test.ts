import { describe, it, expect, afterEach } from "vitest";
import { detectRuntimeMode, usesSupabase } from "./runtimeMode";

describe("runtime mode", () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
  });

  it("returns MOCK_LOCAL when mock env set", () => {
    process.env.NEXT_PUBLIC_MOCK_MODE = "true";
    expect(detectRuntimeMode()).toBe("MOCK_LOCAL");
    expect(usesSupabase()).toBe(false);
  });
});
