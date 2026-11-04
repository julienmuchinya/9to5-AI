import { isGeorgia, isUsLocation, isUsRemote } from "./discovery/filters";

export interface MatchProfile {
  skills: string[];
  target_roles: string[];
  job_levels: string[];
  min_salary: number | null;
  locations: string[];
  relocation: boolean | null;
  keywords_include: string[];
  keywords_exclude: string[];
  excluded_companies: string[];
}

export interface MatchPosting {
  title: string;
  company_name: string;
  level: string | null;
  locations: string[];
  is_remote: boolean;
  salary_min: number | null;
  salary_max: number | null;
  description: string | null;
}

export interface MatchResult {
  eligible: boolean;
  score: number;
  reasons: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const STOP = new Set(["and", "or", "the", "of", "a", "an", "in", "to", "for", "with", "i", "ii", "iii", "intern", "internship", "new", "grad", "junior", "senior"]);

function hasTerm(haystack: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(haystack);
}

export function matchPosting(profile: MatchProfile, p: MatchPosting): MatchResult {
  const reasons: string[] = [];
  const title = norm(p.title);
  const text = norm(`${p.title} ${p.description ?? ""}`);
  const level = p.level ?? "mid";
  const levels = new Set(profile.job_levels?.length ? profile.job_levels : ["internship", "new_grad", "entry"]);
  const minSalary = profile.min_salary ?? 0;
  const salaryTop = p.salary_max ?? p.salary_min ?? null;

  if (profile.excluded_companies?.some((c) => norm(c) === norm(p.company_name)))
    return { eligible: false, score: 0, reasons: ["Company excluded"] };
  const banned = profile.keywords_exclude?.find((k) => hasTerm(text, k));
  if (banned) return { eligible: false, score: 0, reasons: [`Contains excluded keyword "${banned}"`] };

  // Level + pay: internships ignore pay; full-time roles must meet the minimum when pay is listed.
  const paysEnough = salaryTop != null && salaryTop >= minSalary;
  let levelOk = levels.has(level);
  if (!levelOk && (level === "entry" || level === "mid") && paysEnough) levelOk = true;
  if (!levelOk) return { eligible: false, score: 0, reasons: [`Level "${level}" not in your preferences`] };
  if (level !== "internship" && salaryTop != null && minSalary && salaryTop < minSalary)
    return { eligible: false, score: 0, reasons: [`Pay up to $${Math.round(salaryTop / 1000)}k is below your $${Math.round(minSalary / 1000)}k minimum`] };

  // Location.
  const locs = p.locations ?? [];
  const wants = new Set(profile.locations?.length ? profile.locations : ["remote_us", "GA"]);
  const anywhere = wants.has("anywhere_us") || (profile.relocation && (level === "internship" || level === "new_grad"));
  const remoteOk = p.is_remote && (isUsRemote(locs.join(" | ")) || locs.some(isUsLocation));
  const gaOk = locs.some(isGeorgia);
  const usOk = locs.some(isUsLocation) || remoteOk;
  let locationOk = false;
  if (wants.has("remote_us") && remoteOk) {
    locationOk = true;
    reasons.push("Remote, open to US");
  }
  if (wants.has("GA") && gaOk) {
    locationOk = true;
    reasons.push("Located in Georgia");
  }
  if (!locationOk && anywhere && usOk) {
    locationOk = true;
    reasons.push("US location (you're open to relocating)");
  }
  if (!locationOk) return { eligible: false, score: 0, reasons: ["Location doesn't match your preferences"] };

  // Fit score.
  const skills = [...new Set((profile.skills ?? []).map((s) => s.trim()).filter(Boolean))];
  const matched = skills.filter((s) => hasTerm(text, s));
  const skillScore = skills.length ? Math.min(1, matched.length / Math.min(8, skills.length)) : 0.3;
  if (matched.length) reasons.push(`Matches your skills: ${matched.slice(0, 6).join(", ")}`);

  let roleScore = 0;
  for (const role of profile.target_roles ?? []) {
    const words = norm(role).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
    if (!words.length) continue;
    const hit = words.filter((w) => title.includes(w)).length / words.length;
    roleScore = Math.max(roleScore, hit);
  }
  if (roleScore >= 0.5) reasons.push("Title matches your target roles");

  const include = (profile.keywords_include ?? []).filter((k) => hasTerm(text, k));
  if (include.length) reasons.push(`Has your keywords: ${include.join(", ")}`);

  let score = 20 + 40 * skillScore + 30 * roleScore + Math.min(10, include.length * 5);
  if (paysEnough) {
    score += 5;
    reasons.push(`Pays up to $${Math.round((salaryTop ?? 0) / 1000)}k`);
  }
  if (gaOk || remoteOk) score += 5;
  return { eligible: true, score: Math.round(Math.min(100, score)), reasons };
}
