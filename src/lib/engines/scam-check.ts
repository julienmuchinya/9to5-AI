import type { ScamResult } from "../types";
import { SCAM_KEYWORDS } from "../constants";

export function runScamCheck(description: string, applicationUrl?: string): ScamResult {
  const signals: ScamResult["signals"] = [];
  let penalty = 0;

  for (const { pattern, code, weight } of SCAM_KEYWORDS) {
    if (pattern.test(description)) {
      signals.push({ code, weight, message: `Detected: ${code}` });
      penalty += weight;
    }
  }

  if (/salary.*\$(\d{3,})/i.test(description)) {
    const match = description.match(/\$(\d+)/);
    if (match && parseInt(match[1], 10) > 150) {
      signals.push({
        code: "SALARY_TOO_HIGH",
        weight: 20,
        message: "Hourly rate may be unrealistic for intern role",
      });
      penalty += 20;
    }
  }

  if (applicationUrl && /bit\.ly|tinyurl|t\.co/i.test(applicationUrl)) {
    signals.push({
      code: "SUSPICIOUS_LINK",
      weight: 40,
      message: "Shortened URL detected",
    });
    penalty += 40;
  }

  const score = Math.max(0, 100 - penalty);
  const passed = score >= 70 && !signals.some((s) => s.weight >= 100);

  return { passed, score, signals };
}
