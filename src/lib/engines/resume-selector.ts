import {
  RESUME_REUSE_MIN,
  RESUME_KEYWORD_MIN,
  RESUME_TAILOR_MIN,
} from "../constants";
import type { ResumeMatchResult } from "../types";
import { extractSkillsFromJD } from "./job-fit";

export interface ResumeTemplate {
  id: string;
  name: string;
  slug: string;
  content: string;
  skills: string[];
  is_active: boolean;
}

export function scoreResumeTemplates(
  description: string,
  templates: ResumeTemplate[]
): ResumeMatchResult[] {
  const { required, preferred } = extractSkillsFromJD(description);
  const allJdSkills = [...required, ...preferred];

  return templates
    .filter((t) => t.is_active)
    .map((template) => {
      const templateSkills = template.skills.map((s) => s.toLowerCase());
      const contentLower = template.content.toLowerCase();

      const reqHits = required.filter(
        (s) =>
          templateSkills.some((t) => t.includes(s) || s.includes(t)) ||
          contentLower.includes(s)
      );
      const prefHits = preferred.filter(
        (s) =>
          templateSkills.some((t) => t.includes(s) || s.includes(t)) ||
          contentLower.includes(s)
      );
      const keywordHits = allJdSkills.filter((s) => contentLower.includes(s));

      const requiredScore =
        required.length === 0 ? 80 : (reqHits.length / required.length) * 100;
      const preferredScore =
        preferred.length === 0 ? 70 : (prefHits.length / preferred.length) * 100;
      const respScore = template.slug.includes("intern") ? 88 : 75;
      const atsScore = Math.min(100, keywordHits.length * 15);

      const score = Math.round(
        requiredScore * 0.5 +
          respScore * 0.25 +
          preferredScore * 0.15 +
          atsScore * 0.1
      );

      let editTier: ResumeMatchResult["editTier"] = "generated";
      if (score >= RESUME_REUSE_MIN) editTier = "none";
      else if (score >= RESUME_KEYWORD_MIN) editTier = "keywords";
      else if (score >= RESUME_TAILOR_MIN) editTier = "tailor";
      else editTier = "generated";

      return {
        templateId: template.id,
        templateName: template.name,
        score: Math.min(100, score),
        editTier,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function pickBestResume(
  description: string,
  templates: ResumeTemplate[]
): ResumeMatchResult | null {
  const scored = scoreResumeTemplates(description, templates);
  return scored[0] ?? null;
}
