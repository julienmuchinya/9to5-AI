import { describe, it, expect } from "vitest";
import {
  jobMentionsSponsorship,
  isSponsorshipQuestionUnanswered,
} from "./sponsorship-guard";

describe("sponsorship guard", () => {
  it("detects sponsorship in JD", () => {
    expect(jobMentionsSponsorship("Must be authorized to work in the US. Sponsorship not available.")).toBe(true);
  });

  it("blocks auto-answer when unanswered", () => {
    expect(
      isSponsorshipQuestionUnanswered(
        "Do you require visa sponsorship?",
        undefined,
        []
      )
    ).toBe(true);
  });

  it("allows when profile has sponsorship flag", () => {
    expect(
      isSponsorshipQuestionUnanswered(
        "Do you require visa sponsorship?",
        false,
        []
      )
    ).toBe(false);
  });
});
