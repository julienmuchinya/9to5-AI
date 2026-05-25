import { describe, it, expect } from "vitest";
import { findCacheHit, getJdHash } from "./ai-cache";

describe("ai-cache Part 3", () => {
  it("returns cache hit for same description", () => {
    const desc = "Required: Python, React. Intern role.";
    const hash = getJdHash(desc);
    const hit = findCacheHit(desc, [
      { jdHash: hash, output: {}, fitScore: 88, createdAt: "" },
    ]);
    expect(hit?.fitScore).toBe(88);
  });
});
