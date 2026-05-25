import { describe, it, expect } from "vitest";
import { evaluateSetupChecklist, isSetupComplete } from "./setup-checklist";

describe("setup checklist", () => {
  it("reports incomplete when profile missing", () => {
    const items = evaluateSetupChecklist({
      supabaseConfigured: true,
      schemaInstalled: true,
      geminiOrMock: true,
      gmailConnected: true,
      jobEmailSet: false,
      profileComplete: false,
      companyCount: 1,
      activeResumeCount: 5,
      coverLetterCount: 5,
      evidenceCount: 10,
      limitsConfigured: true,
      lastAgentRunOk: true,
      emergencyStopVisible: true,
    });
    expect(isSetupComplete(items)).toBe(false);
  });

  it("allows mock mode without supabase items", () => {
    const items = evaluateSetupChecklist({
      supabaseConfigured: false,
      schemaInstalled: false,
      geminiOrMock: true,
      gmailConnected: false,
      jobEmailSet: true,
      profileComplete: true,
      companyCount: 1,
      activeResumeCount: 5,
      coverLetterCount: 9,
      evidenceCount: 10,
      limitsConfigured: true,
      lastAgentRunOk: false,
      emergencyStopVisible: true,
    });
    expect(isSetupComplete(items, { mockMode: true })).toBe(true);
  });

  it("reports complete when all pass", () => {
    const items = evaluateSetupChecklist({
      supabaseConfigured: true,
      schemaInstalled: true,
      geminiOrMock: true,
      gmailConnected: true,
      jobEmailSet: true,
      profileComplete: true,
      companyCount: 5,
      activeResumeCount: 5,
      coverLetterCount: 5,
      evidenceCount: 10,
      limitsConfigured: true,
      lastAgentRunOk: true,
      emergencyStopVisible: true,
    });
    expect(isSetupComplete(items)).toBe(true);
  });
});
