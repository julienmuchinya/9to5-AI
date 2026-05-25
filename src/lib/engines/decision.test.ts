import { describe, it, expect } from "vitest";
import { makeDecision } from "./decision";

const base = {
  emergencyStop: false,
  autoApplyEnabled: true,
  setupComplete: true,
  duplicateJob: false,
  duplicateApplication: false,
  truthFilterPassed: true,
  costRisk: false,
  captchaDetected: false,
  requiresLying: false,
  scamPassed: true,
  sponsorshipQuestionUnanswered: false,
};

describe("decision engine", () => {
  it("returns EMERGENCY_STOP when enabled", () => {
    expect(makeDecision({ ...base, emergencyStop: true, fitScore: 95, trustScore: 90, resumeMatchScore: 95, coverLetterMatchScore: 95 }).decision).toBe("EMERGENCY_STOP");
  });

  it("returns BLOCKED when trust low", () => {
    expect(makeDecision({ ...base, fitScore: 95, trustScore: 70, resumeMatchScore: 95, coverLetterMatchScore: 95 }).decision).toBe("BLOCKED");
  });

  it("returns SKIP when fit low", () => {
    expect(makeDecision({ ...base, fitScore: 60, trustScore: 85, resumeMatchScore: 80, coverLetterMatchScore: 80 }).decision).toBe("SKIP");
  });

  it("returns AUTO_APPLY_READY when all gates pass", () => {
    expect(makeDecision({ ...base, fitScore: 92, trustScore: 85, resumeMatchScore: 92, coverLetterMatchScore: 92 }).decision).toBe("AUTO_APPLY_READY");
  });

  it("returns REVIEW_ONLY when fit in review band", () => {
    expect(makeDecision({ ...base, autoApplyEnabled: false, fitScore: 80, trustScore: 85, resumeMatchScore: 80, coverLetterMatchScore: 85 }).decision).toBe("REVIEW_ONLY");
  });
});
