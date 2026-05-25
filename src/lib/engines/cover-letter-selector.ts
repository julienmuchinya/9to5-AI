import { COVER_LETTER_REUSE_MIN } from "../constants";
import type { CoverLetterMatchResult } from "../types";

export interface CoverLetterTemplate {
  id: string;
  name: string;
  slug: string;
  content: string;
}

const SLUG_KEYWORDS: Record<string, string[]> = {
  swe: ["software engineer", "software engineering", "swe", "developer intern"],
  backend: ["backend", "api", "server", "java", "python", "spring", "fastapi"],
  frontend: ["frontend", "react", "ui", "ux", "typescript", "javascript"],
  "cloud-devops": ["devops", "cloud", "aws", "docker", "kubernetes", "ci/cd"],
  "data-analyst": ["data analyst", "sql", "analytics", "excel", "tableau"],
  "ai-ml": ["machine learning", "ai", "ml", "python", "model"],
  "it-support": ["it support", "help desk", "cloud support", "troubleshoot"],
  "network-systems": ["network", "systems engineer", "infrastructure"],
  "tech-consultant": ["consultant", "client", "implementation", "business technology"],
};

export function scoreCoverLetterTemplates(
  description: string,
  templates: CoverLetterTemplate[],
  jobTitle: string
): CoverLetterMatchResult[] {
  const lower = `${description} ${jobTitle}`.toLowerCase();

  return templates
    .map((template) => {
      const keywords = SLUG_KEYWORDS[template.slug] ?? [];
      const hits = keywords.filter((k) => lower.includes(k));
      const slugHit = lower.includes(template.slug.replace("-", " ")) ? 15 : 0;
      const contentHits = template.content
        .toLowerCase()
        .split(" ")
        .filter((w) => w.length > 4 && lower.includes(w)).length;

      const score = Math.min(
        100,
        Math.round((hits.length / Math.max(keywords.length, 1)) * 70 + slugHit + contentHits * 2)
      );

      return {
        templateId: template.id,
        templateName: template.name,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function pickBestCoverLetter(
  description: string,
  templates: CoverLetterTemplate[],
  jobTitle: string
): CoverLetterMatchResult | null {
  const scored = scoreCoverLetterTemplates(description, templates, jobTitle);
  return scored[0] ?? null;
}

export function shouldReuseCoverLetter(match: CoverLetterMatchResult | null): boolean {
  return (match?.score ?? 0) >= COVER_LETTER_REUSE_MIN;
}
