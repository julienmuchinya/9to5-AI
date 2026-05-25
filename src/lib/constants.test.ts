import { describe, it, expect } from "vitest";
import {
  RESUME_TEMPLATE_SEEDS,
  COVER_LETTER_TEMPLATE_SEEDS,
  DEFAULT_USAGE_LIMITS,
  PASSWORD_STORAGE_ENABLED,
} from "./constants";

describe("Phase 1 constants", () => {
  it("has 15 resume templates with 5 active by default", () => {
    expect(RESUME_TEMPLATE_SEEDS.length).toBe(15);
    expect(RESUME_TEMPLATE_SEEDS.filter((t) => t.active).length).toBe(5);
  });

  it("has 9 cover letter templates", () => {
    expect(COVER_LETTER_TEMPLATE_SEEDS.length).toBe(9);
  });

  it("defaults cost to $0", () => {
    expect(DEFAULT_USAGE_LIMITS.maxCostPerDay).toBe(0);
    expect(DEFAULT_USAGE_LIMITS.maxCostPerMonth).toBe(0);
  });

  it("disables encrypted password storage by default", () => {
    expect(PASSWORD_STORAGE_ENABLED).toBe(false);
  });
});
