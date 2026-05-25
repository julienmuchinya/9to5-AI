import type { TrustResult } from "../types";
import { KNOWN_ATS_DOMAINS } from "../constants";

export function scoreCompanyTrust(
  companyName: string,
  domain?: string,
  careerUrl?: string,
  applicationUrl?: string
): TrustResult {
  const signals: string[] = [];
  let score = 85;

  if (!companyName || companyName.length < 2) {
    signals.push("MISSING_COMPANY_NAME");
    score -= 30;
  }

  if (domain) {
    const freeProviders = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
    if (freeProviders.some((p) => domain.includes(p))) {
      signals.push("FREE_EMAIL_DOMAIN");
      score -= 25;
    } else {
      signals.push("HAS_CORPORATE_DOMAIN");
      score += 5;
    }
  } else {
    signals.push("NO_DOMAIN");
    score -= 10;
  }

  if (careerUrl) {
    signals.push("HAS_CAREER_PAGE");
    score += 5;
  }

  if (applicationUrl) {
    const onKnownAts = KNOWN_ATS_DOMAINS.some((ats) => applicationUrl.includes(ats));
    if (onKnownAts) {
      signals.push("KNOWN_ATS");
      score += 10;
    } else if (domain && !applicationUrl.includes(domain.replace("www.", ""))) {
      signals.push("URL_DOMAIN_MISMATCH");
      score -= 15;
    }
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    signals,
  };
}
