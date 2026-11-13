import { isGeorgia, isInState, isUsLocation, isUsRemote } from "./discovery/filters";

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
  /** Roles the user asked for most recently (chat): ranked first, any US location, any level but senior. */
  focus_roles?: string[];
  /** The user's own state (profile), for the "In my state" location choice. */
  home_state?: string | null;
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

/**
 * Is this posting one of the focus roles? A title role ("Roustabout", "Field Operator") must be in the
 * title; an industry ("oil and gas", "offshore") may also be in the start of the description.
 */
export function isFocusTitle(title: string, roles: string[] | null | undefined, description = ""): boolean {
  if (!roles?.length) return false;
  const t = norm(title);
  const d = norm(`${title} ${description.slice(0, 800)}`);
  return roles.some((r) => {
    const words = norm(r).split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !/^(jobs?|roles?|level|entry|positions?|work)$/.test(w));
    if (!words.length) return false;
    if (words.every((w) => t.includes(w))) return true;
    return INDUSTRY.test(r) && words.every((w) => d.includes(w));
  });
}
const INDUSTRY = /\b(oil|gas|petroleum|offshore|energy|mining|mineral|pipeline|refinery|drilling|utilit|renewable|solar|wind)/i;

export function matchPosting(profile: MatchProfile, p: MatchPosting): MatchResult {
  const reasons: string[] = [];
  const title = norm(p.title);
  const text = norm(`${p.title} ${p.description ?? ""}`);
  const level = p.level ?? "mid";
  const levels = new Set(profile.job_levels?.length ? profile.job_levels : ["internship", "new_grad", "entry"]);
  const minSalary = profile.min_salary ?? 0;
  const salaryTop = p.salary_max ?? p.salary_min ?? null;
  const focus = isFocusTitle(p.title, profile.focus_roles, p.description ?? "");

  if (profile.excluded_companies?.some((c) => norm(c) === norm(p.company_name)))
    return { eligible: false, score: 0, reasons: ["Company excluded"] };
  const banned = profile.keywords_exclude?.find((k) => hasTerm(text, k));
  if (banned) return { eligible: false, score: 0, reasons: [`Contains excluded keyword "${banned}"`] };

  // Level + pay: internships ignore pay; full-time roles must meet the minimum when pay is listed.
  const paysEnough = salaryTop != null && salaryTop >= minSalary;
  let levelOk = levels.has(level);
  // A role the user just asked for: field / offshore postings rarely say "entry level", so take anything short of senior.
  if (focus && level !== "senior") levelOk = true;
  if (!levelOk && (level === "entry" || level === "mid") && paysEnough) levelOk = true;
  if (!levelOk) return { eligible: false, score: 0, reasons: [`Level "${level}" not in your preferences`] };
  if (level !== "internship" && salaryTop != null && minSalary && salaryTop < minSalary)
    return { eligible: false, score: 0, reasons: [`Pay up to $${Math.round(salaryTop / 1000)}k is below your $${Math.round(minSalary / 1000)}k minimum`] };

  // Location.
  const locs = p.locations ?? [];
  const wants = new Set(profile.locations?.length ? profile.locations : ["remote_us", "my_state"]);
  const anywhere = wants.has("anywhere_us") || (profile.relocation && (level === "internship" || level === "new_grad"));
  const remoteOk = p.is_remote && (isUsRemote(locs.join(" | ")) || locs.some(isUsLocation));
  const gaOk = locs.some(isGeorgia);
  const usOk = locs.some(isUsLocation) || remoteOk;
  let locationOk = false;
  if (wants.has("remote_us") && remoteOk) {
    locationOk = true;
    reasons.push("Remote, open to US");
  }
  if (wants.has("my_state") && locs.some((l) => isInState(l, profile.home_state))) {
    locationOk = true;
    reasons.push(`In your state (${profile.home_state})`);
  }
  if (!locationOk && wants.has("GA") && gaOk) {
    locationOk = true;
    reasons.push("Located in Georgia");
  }
  if (!locationOk && anywhere && usOk) {
    locationOk = true;
    reasons.push("US location (you're open to relocating)");
  }
  // Rigs, plants and fields are where they are: for the role the user asked for, any US location goes.
  if (!locationOk && focus && usOk) {
    locationOk = true;
    reasons.push("US location (the role you asked for)");
  }
  if (!locationOk) return { eligible: false, score: 0, reasons: ["Location doesn't match your preferences"] };

  // Fit score.
  const skills = [...new Set((profile.skills ?? []).map((s) => s.trim()).filter(Boolean))];
  const matched = skills.filter((s) => hasTerm(text, s));
  const skillScore = skills.length ? Math.min(1, matched.length / Math.min(8, skills.length)) : 0.3;
  if (matched.length) reasons.push(`Matches your skills: ${matched.slice(0, 6).join(", ")}`);

  // Whole words only: "ai" must not match "maintainer", "ml" must not match "html".
  const titleWords = new Set(title.split(" "));
  const inTitle = (w: string) => titleWords.has(w) || (w.length >= 5 && title.includes(w));
  let roleScore = 0;
  for (const role of profile.target_roles ?? []) {
    const words = norm(role).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
    if (!words.length) continue;
    const hit = words.filter(inTitle).length / words.length;
    roleScore = Math.max(roleScore, hit);
  }
  if (focus) {
    roleScore = 1;
    reasons.push("The role you asked for");
  } else if (roleScore >= 0.5) reasons.push("Title matches your target roles");

  // Seniority in the title vs the levels you want.
  const wantsEarly = [...levels].some((l) => l === "internship" || l === "new_grad" || l === "entry");
  const wantsSenior = levels.has("senior") || levels.has("mid");
  const seniorTitle = /\b(senior|sr|staff|principal|lead|manager|director|head|architect|vp)\b/.test(title);
  const earlyTitle = /\b(intern|internship|co op|coop|new grad|graduate|entry|junior|jr|associate|early career|university|apprentice|i)\b/.test(title);
  let titleAdj = 0;
  if (seniorTitle && wantsEarly && !wantsSenior) {
    titleAdj -= 25;
    reasons.push("Title looks senior");
  } else if (earlyTitle && wantsEarly) titleAdj += 8;
  // Engineering roles only: sales, recruiting, support-desk and similar titles rank far down.
  // …unless it's a title the user asked for ("Field Service Technician").
  if (roleScore < 0.5 && /\b(sales|account executive|recruit\w*|marketing|customer success|technician|nurse|counsel|attorney|accountant|teacher|driver)\b/.test(title)) {
    titleAdj -= 30;
    reasons.push("Not an engineering title");
  }

  const include = (profile.keywords_include ?? []).filter((k) => hasTerm(text, k));
  if (include.length) reasons.push(`Has your keywords: ${include.join(", ")}`);

  let score = 20 + 40 * skillScore + 30 * roleScore + Math.min(10, include.length * 5) + titleAdj;
  if (paysEnough) {
    score += 5;
    reasons.push(`Pays up to $${Math.round((salaryTop ?? 0) / 1000)}k`);
  }
  if (gaOk || remoteOk) score += 5;
  // Skills on a software resume rarely appear in a field posting: the role match carries it.
  if (focus) score += 20;
  return { eligible: true, score: Math.round(Math.max(0, Math.min(100, score))), reasons };
}
