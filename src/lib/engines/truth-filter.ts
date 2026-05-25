import type { EvidenceItem } from "../types";

export function validateClaimsAgainstEvidence(
  text: string,
  evidence: EvidenceItem[]
): { passed: boolean; unsupportedClaims: string[] } {
  const approvedSkills = new Set(
    evidence
      .filter((e) => e.approved !== false)
      .flatMap((e) => [
        ...(e.skills ?? []),
        ...(e.tools ?? []),
        e.title,
        ...e.content.split(/\s+/),
      ])
      .map((s) => s.toLowerCase())
      .filter((s) => s.length > 2)
  );

  const redFlags = [
    /(\d{2,})\+?\s*years?\s*(of\s*)?experience/i,
    /expert\s+in\s+/i,
    /senior\s+architect/i,
    /led\s+team\s+of\s+\d+/i,
  ];

  const unsupportedClaims: string[] = [];

  for (const flag of redFlags) {
    if (flag.test(text)) {
      unsupportedClaims.push(`Potentially inflated claim: ${flag.source}`);
    }
  }

  const claimPatterns = text.match(/\b(Java|Python|React|AWS|Kubernetes|Docker|Spring)\b/gi) ?? [];
  for (const claim of claimPatterns) {
    const lower = claim.toLowerCase();
    const supported = [...approvedSkills].some(
      (s) => s.includes(lower) || lower.includes(s)
    );
    if (!supported) {
      unsupportedClaims.push(`Skill not in Evidence Bank: ${claim}`);
    }
  }

  return {
    passed: unsupportedClaims.length === 0,
    unsupportedClaims,
  };
}
