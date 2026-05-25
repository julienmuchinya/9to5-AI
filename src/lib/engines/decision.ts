import {
  FIT_AUTO_APPLY_MIN,
  FIT_REVIEW_MIN,
  TRUST_BLOCK_MAX,
  RESUME_TAILOR_MIN,
  COVER_LETTER_REUSE_MIN,
} from "../constants";
import type { DecisionInput, DecisionOutput } from "../types";

export function makeDecision(input: DecisionInput): DecisionOutput {
  if (input.emergencyStop) {
    return {
      decision: "EMERGENCY_STOP",
      reason: "Emergency stop is enabled",
      reasonCode: "EMERGENCY_STOP",
    };
  }

  if (input.costRisk) {
    return {
      decision: "BLOCKED",
      reason: "Action may incur a charge — blocked by budget guard",
      reasonCode: "COST_RISK",
    };
  }

  if (input.duplicateJob || input.duplicateApplication) {
    return {
      decision: "BLOCKED",
      reason: "Already applied or processing this job",
      reasonCode: "DUPLICATE_JOB",
    };
  }

  if (input.sponsorshipQuestionUnanswered) {
    return {
      decision: "REVIEW_ONLY",
      reason: "Sponsorship or work authorization question requires your saved answer",
      reasonCode: "SPONSORSHIP_UNKNOWN",
    };
  }

  if (!input.scamPassed) {
    return {
      decision: "BLOCKED",
      reason: "Scam check failed",
      reasonCode: "SCAM_DETECTED",
    };
  }

  if (input.trustScore < TRUST_BLOCK_MAX) {
    return {
      decision: "BLOCKED",
      reason: `Company trust score ${input.trustScore} is below ${TRUST_BLOCK_MAX}`,
      reasonCode: "TRUST_LOW",
    };
  }

  if (input.requiresLying || !input.truthFilterPassed) {
    return {
      decision: "BLOCKED",
      reason: "Application would require unsupported claims",
      reasonCode: "TRUTH_FILTER_FAILED",
    };
  }

  if (input.captchaDetected) {
    return {
      decision: "BLOCKED",
      reason: "Captcha or automation block detected — human action required",
      reasonCode: "CAPTCHA_REQUIRED",
    };
  }

  if (input.fitScore < FIT_REVIEW_MIN) {
    return {
      decision: "SKIP",
      reason: `Fit score ${input.fitScore} is below ${FIT_REVIEW_MIN}`,
      reasonCode: "FIT_LOW",
    };
  }

  const canAutoApply =
    input.autoApplyEnabled &&
    input.setupComplete &&
    input.fitScore >= FIT_AUTO_APPLY_MIN &&
    input.resumeMatchScore >= 90 &&
    input.coverLetterMatchScore >= COVER_LETTER_REUSE_MIN &&
    input.truthFilterPassed;

  if (canAutoApply) {
    return {
      decision: "AUTO_APPLY_READY",
      reason: "Ready for future auto-apply (Part 4) — not submitted in Part 3",
      reasonCode: "AUTO_APPLY_READY",
    };
  }

  if (
    input.fitScore >= FIT_REVIEW_MIN ||
    input.resumeMatchScore >= RESUME_TAILOR_MIN
  ) {
    return {
      decision: "REVIEW_ONLY",
      reason: "Needs human review before applying",
      reasonCode: "NEEDS_REVIEW",
    };
  }

  return {
    decision: "SKIP",
    reason: "Did not meet review threshold",
    reasonCode: "SKIP_DEFAULT",
  };
}
