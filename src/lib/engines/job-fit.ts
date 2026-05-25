import type { FitResult } from "../types";

const SKILL_PATTERNS = [
  "java", "python", "react", "typescript", "javascript", "sql", "postgresql",
  "firebase", "flask", "fastapi", "spring", "docker", "aws", "git", "rest",
  "node", "kubernetes", "redis", "graphql", "tailwind", "next.js", "nextjs",
];

export function extractSkillsFromJD(description: string): {
  required: string[];
  preferred: string[];
} {
  const lower = description.toLowerCase();
  const required: string[] = [];
  const preferred: string[] = [];

  for (const skill of SKILL_PATTERNS) {
    if (lower.includes(skill)) {
      const inRequired =
        lower.includes(`required`) &&
        lower.indexOf(skill) < lower.indexOf("preferred", lower.indexOf(skill) || 99999);
      if (
        lower.includes(`required: ${skill}`) ||
        lower.includes(`${skill} required`) ||
        lower.includes(`must have ${skill}`)
      ) {
        required.push(skill);
      } else if (lower.includes(`preferred`) && lower.includes(skill)) {
        preferred.push(skill);
      } else if (inRequired || lower.includes("requirements")) {
        required.push(skill);
      } else {
        preferred.push(skill);
      }
    }
  }

  return {
    required: [...new Set(required)],
    preferred: [...new Set(preferred)].filter((s) => !required.includes(s)),
  };
}

export function scoreJobFit(
  description: string,
  userSkills: string[],
  evidenceSkills: string[]
): FitResult {
  const allSkills = [...new Set([...userSkills, ...evidenceSkills].map((s) => s.toLowerCase()))];
  const { required, preferred } = extractSkillsFromJD(description);

  const reqMatched = required.filter((s) => allSkills.some((u) => u.includes(s) || s.includes(u)));
  const reqMissing = required.filter((s) => !reqMatched.includes(s));
  const prefMatched = preferred.filter((s) =>
    allSkills.some((u) => u.includes(s) || s.includes(u))
  );

  const requiredScore =
    required.length === 0 ? 85 : (reqMatched.length / required.length) * 100;
  const preferredScore =
    preferred.length === 0 ? 80 : (prefMatched.length / preferred.length) * 100;

  const respScore = description.toLowerCase().includes("intern") ? 90 : 75;
  const atsScore = Math.min(100, (reqMatched.length + prefMatched.length) * 12);

  const score = Math.round(
    requiredScore * 0.5 +
      respScore * 0.25 +
      preferredScore * 0.15 +
      atsScore * 0.1
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    requiredSkillsMatched: reqMatched,
    requiredSkillsMissing: reqMissing,
    breakdown: {
      requiredSkills: Math.round(requiredScore),
      responsibilities: respScore,
      preferredSkills: Math.round(preferredScore),
      atsKeywords: Math.min(100, atsScore),
    },
  };
}
