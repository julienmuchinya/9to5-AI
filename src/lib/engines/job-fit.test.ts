import { describe, it, expect } from "vitest";
import { scoreJobFit } from "./job-fit";

describe("job-fit engine", () => {
  it("scores high when required skills match", () => {
    const result = scoreJobFit(
      "Required: Python, React, REST APIs. Intern role.",
      ["Python", "React", "Java"],
      ["python", "react"]
    );
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.requiredSkillsMatched.length).toBeGreaterThan(0);
  });

  it("scores low when skills missing", () => {
    const result = scoreJobFit(
      "Required: Kubernetes, Terraform, 10 years experience",
      ["Java"],
      []
    );
    expect(result.score).toBeLessThan(90);
  });
});
