import { isMockModeEnv } from "@/lib/config/env";
import { scanCareerPage, type CareerPageJob } from "./careerPageScanner";

export interface CompanyScanTarget {
  id: string;
  name: string;
  career_url?: string;
  scan_enabled: boolean;
}

export interface CompanyScanOptions {
  maxCompaniesPerRun: number;
  delayMsBetweenScans: number;
  onDelay?: (companyName: string, ms: number) => void;
}

export interface CompanyScanResult {
  jobs: CareerPageJob[];
  companiesScanned: number;
  blockedReasons: Array<{ company: string; reason: string }>;
}

export async function scanCompanies(
  companies: CompanyScanTarget[],
  options: CompanyScanOptions
): Promise<CompanyScanResult> {
  const enabled = companies
    .filter((c) => c.scan_enabled && c.career_url)
    .slice(0, options.maxCompaniesPerRun);

  const jobs: CareerPageJob[] = [];
  const blockedReasons: Array<{ company: string; reason: string }> = [];

  for (const company of enabled) {
    if (options.delayMsBetweenScans > 0 && options.onDelay) {
      options.onDelay(company.name, options.delayMsBetweenScans);
      await sleep(options.delayMsBetweenScans);
    } else if (options.delayMsBetweenScans > 0) {
      await sleep(options.delayMsBetweenScans);
    }

    const result = await scanCareerPage(company.name, company.career_url!);
    if (result.blocked && result.blockReason) {
      blockedReasons.push({ company: company.name, reason: result.blockReason });
    }
    jobs.push(...result.jobs);
  }

  return {
    jobs,
    companiesScanned: enabled.length,
    blockedReasons,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isCompanyScannerMock(): boolean {
  return isMockModeEnv();
}
