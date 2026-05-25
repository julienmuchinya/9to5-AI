import { describe, it, expect } from "vitest";
import { runScamCheck } from "./scam-check";

describe("scam check engine", () => {
  it("fails on SSN request", () => {
    const r = runScamCheck("Please provide your SSN before interview");
    expect(r.passed).toBe(false);
    expect(r.signals.some((s) => s.code === "SSN_REQUESTED")).toBe(true);
  });

  it("passes normal intern JD", () => {
    const r = runScamCheck("Software Engineer Intern. Python, React. Remote US.");
    expect(r.passed).toBe(true);
  });
});
