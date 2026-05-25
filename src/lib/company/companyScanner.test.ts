import { describe, it, expect, beforeEach } from "vitest";
import { scanCompanies, isCompanyScannerMock } from "./companyScanner";

describe("companyScanner mock mode", () => {
  beforeEach(() => {
    process.env.MOCK_MODE = "true";
  });

  it("uses mock mode", () => {
    expect(isCompanyScannerMock()).toBe(true);
  });

  it("returns mock company jobs", async () => {
    const result = await scanCompanies(
      [
        {
          id: "1",
          name: "Acme Tech",
          career_url: "https://boards.greenhouse.io/acme",
          scan_enabled: true,
        },
      ],
      { maxCompaniesPerRun: 5, delayMsBetweenScans: 0 }
    );
    expect(result.companiesScanned).toBe(1);
    expect(result.jobs.length).toBeGreaterThan(0);
  });
});
