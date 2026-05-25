import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("GitHub Actions safe defaults", () => {
  it("defaults workflow to mock and dry_run", () => {
    const yml = readFileSync(
      join(process.cwd(), ".github/workflows/daily-agent.yml"),
      "utf-8"
    );
    expect(yml).toContain('default: mock');
    expect(yml).toContain('default: true');
    expect(yml).toContain("LIVE_AGENT_ENABLED");
    expect(yml).toContain("agent:mock");
    expect(yml).not.toMatch(/echo.*AGENT_SECRET/i);
  });
});
