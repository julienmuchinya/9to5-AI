import { detectAtsFromUrl } from "./atsDetector";
import { MOCK_COMPANY_JOBS } from "@/lib/mock/data";
import { isMockModeEnv } from "@/lib/config/env";

export interface CareerPageJob {
  companyName: string;
  title: string;
  url: string;
  location?: string;
  department?: string;
  description?: string;
  source: string;
  dateFound: string;
}

export interface CareerScanResult {
  jobs: CareerPageJob[];
  blocked: boolean;
  blockReason?: string;
}

export function isCompanyScanMockMode(): boolean {
  return isMockModeEnv();
}

/**
 * Safe career page scan — mock returns seeded jobs; live uses fetch with no bot bypass.
 */
export async function scanCareerPage(
  companyName: string,
  careerUrl: string
): Promise<CareerScanResult> {
  const ats = detectAtsFromUrl(careerUrl);
  if (!ats.safeToScan) {
    return {
      jobs: [],
      blocked: true,
      blockReason: ats.reason ?? "BLOCKED_WEBSITE",
    };
  }

  if (isCompanyScanMockMode()) {
    const mockJobs = MOCK_COMPANY_JOBS.filter(
      (j) => j.companyName.toLowerCase() === companyName.toLowerCase()
    );
    return {
      jobs: mockJobs.map((j) => ({
        ...j,
        dateFound: new Date().toISOString(),
        source: `career_${ats.platform}`,
      })),
      blocked: false,
    };
  }

  // Live: conservative fetch — stop on captcha/bot signals (no bypass)
  try {
    const res = await fetch(careerUrl, {
      headers: { "User-Agent": "9to5-AI-JobScanner/1.0 (+https://9to5-ai.local)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { jobs: [], blocked: true, blockReason: "PAGE_UNAVAILABLE" };
    }
    const html = await res.text();
    if (/captcha|cf-browser-verification|access denied/i.test(html)) {
      return { jobs: [], blocked: true, blockReason: "CAPTCHA_DETECTED" };
    }
    // Part 3 live parsing is minimal — structured ATS APIs preferred in Part 4
    return { jobs: [], blocked: false };
  } catch {
    return { jobs: [], blocked: true, blockReason: "SCAN_FAILED" };
  }
}
