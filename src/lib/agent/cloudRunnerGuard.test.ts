import { describe, it, expect, afterEach } from "vitest";
import { evaluateCloudRunnerGuard } from "./cloudRunnerGuard";

describe("cloudRunnerGuard", () => {
  const orig = { ...process.env };

  afterEach(() => {
    process.env = { ...orig };
  });

  it("defaults to mock", () => {
    process.env.NEXT_PUBLIC_MOCK_MODE = "true";
    const r = evaluateCloudRunnerGuard({ mode: "live" });
    expect(r.effectiveMode).toBe("mock");
    expect(r.dryRun).toBe(true);
  });
});
