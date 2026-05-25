import { KNOWN_ATS_DOMAINS } from "@/lib/constants";

export type AtsPlatform =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workday"
  | "unknown";

export interface AtsDetection {
  platform: AtsPlatform;
  isPublicBoard: boolean;
  safeToScan: boolean;
  reason?: string;
}

const BLOCKED_SCAN_DOMAINS = [/linkedin\.com/i, /indeed\.com/i];

export function detectAtsFromUrl(url: string): AtsDetection {
  if (BLOCKED_SCAN_DOMAINS.some((p) => p.test(url))) {
    return {
      platform: "unknown",
      isPublicBoard: false,
      safeToScan: false,
      reason: "BLOCKED_WEBSITE",
    };
  }

  const lower = url.toLowerCase();
  if (lower.includes("greenhouse.io") || lower.includes("boards.greenhouse")) {
    return { platform: "greenhouse", isPublicBoard: true, safeToScan: true };
  }
  if (lower.includes("lever.co") || lower.includes("jobs.lever")) {
    return { platform: "lever", isPublicBoard: true, safeToScan: true };
  }
  if (lower.includes("ashbyhq.com")) {
    return { platform: "ashby", isPublicBoard: true, safeToScan: true };
  }
  if (lower.includes("smartrecruiters.com")) {
    return { platform: "smartrecruiters", isPublicBoard: true, safeToScan: true };
  }
  if (lower.includes("myworkdayjobs.com")) {
    return {
      platform: "workday",
      isPublicBoard: true,
      safeToScan: true,
      reason: "Public Workday link only — no protection bypass",
    };
  }

  const known = KNOWN_ATS_DOMAINS.some((d) => lower.includes(d));
  return {
    platform: "unknown",
    isPublicBoard: known,
    safeToScan: !BLOCKED_SCAN_DOMAINS.some((p) => p.test(url)),
  };
}
