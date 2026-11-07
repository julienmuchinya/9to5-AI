import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiJson } from "./gemini";
import { resumeToText, type ParsedResume } from "./resume";

/**
 * Several resumes per person (e.g. "Software", "AI / ML", "Embedded"), kept apart from the profile.
 * The list lives next to the PDFs in the private "resumes" bucket as <user>/library.json, so it needs
 * no database change. The profile's own resume (resume_path / resume_parsed) is always entry "main".
 */
export interface ResumeEntry {
  id: string;
  label: string;
  path: string;
  parsed: ParsedResume | null;
  uploaded_at: string;
}
export interface ResumeLibrary {
  resumes: ResumeEntry[];
}

export const libraryPath = (userId: string) => `${userId}/library.json`;
export const resumeFilePath = (userId: string, id: string) => (id === "main" ? `${userId}/resume.pdf` : `${userId}/resumes/${id}.pdf`);

export async function loadLibrary(
  storage: SupabaseClient,
  userId: string,
  profile: { resume_path?: string | null; resume_parsed?: ParsedResume | null; resume_updated_at?: string | null }
): Promise<ResumeLibrary> {
  let lib: ResumeLibrary = { resumes: [] };
  const { data } = await storage.storage.from("resumes").download(libraryPath(userId));
  if (data) {
    try {
      const parsed = JSON.parse(await data.text()) as ResumeLibrary;
      if (Array.isArray(parsed?.resumes)) lib = parsed;
    } catch {
      // corrupt file: start over from the profile resume
    }
  }
  // The profile resume is the source of truth for "main".
  const others = lib.resumes.filter((r) => r.id !== "main");
  const mainLabel = lib.resumes.find((r) => r.id === "main")?.label ?? "Main resume";
  const main: ResumeEntry[] = profile.resume_path
    ? [{ id: "main", label: mainLabel, path: profile.resume_path, parsed: profile.resume_parsed ?? null, uploaded_at: profile.resume_updated_at ?? "" }]
    : [];
  return { resumes: [...main, ...others] };
}

export async function saveLibrary(storage: SupabaseClient, userId: string, lib: ResumeLibrary) {
  const body = JSON.stringify({ resumes: lib.resumes.map((r) => (r.id === "main" ? { ...r, parsed: null } : r)) });
  const { error } = await storage.storage.from("resumes").upload(libraryPath(userId), new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`Couldn't save the resume list: ${error.message}`);
}

const STOP = new Set("and the for with you our are will this that from have your who all can work team using use able job role new including such other into its etc".split(" "));
const tokens = (s: string) => (s.toLowerCase().match(/[a-z][a-z0-9+#./-]{1,}/g) ?? []).filter((w) => !STOP.has(w));

/** How well a resume's words cover the job's words (0–1). Free: no AI. */
export function resumeJobScore(resume: ParsedResume | null, jobText: string): number {
  if (!resume) return 0;
  const job = new Map<string, number>();
  for (const w of tokens(jobText)) job.set(w, (job.get(w) ?? 0) + 1);
  if (!job.size) return 0;
  const mine = new Set(tokens(`${resumeToText(resume)} ${(resume.skills ?? []).join(" ")} ${(resume.target_roles ?? []).join(" ")}`));
  let hit = 0;
  let total = 0;
  for (const [w, n] of job) {
    const weight = Math.min(n, 4);
    total += weight;
    if (mine.has(w)) hit += weight;
  }
  return hit / total;
}

/** The resume (of several) that best fits this job. */
export function pickResume(lib: ResumeLibrary, jobText: string): ResumeEntry | null {
  const usable = lib.resumes.filter((r) => r.parsed?.experience?.length || r.parsed?.skills?.length);
  if (!usable.length) return lib.resumes[0] ?? null;
  return usable.map((r) => ({ r, s: resumeJobScore(r.parsed, jobText) })).sort((a, b) => b.s - a.s)[0].r;
}

/** Bold the words the job asks for, on bullets that carry no bold of their own. Free. */
export function boldJobKeywords(r: ParsedResume, jobText: string): ParsedResume {
  const want = new Set(tokens(jobText));
  const skills = [...(r.skills ?? []), ...(r.skill_groups ?? []).flatMap((g) => g.items)].filter((s) => s.length > 1 && tokens(s).some((t) => want.has(t)));
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = skills.length ? new RegExp(`(?<![\\w*])(${skills.sort((a, b) => b.length - a.length).map(esc).join("|")})(?![\\w*])`, "g") : null;
  const mark = (b: string) => (b.includes("**") || !re ? b : b.replace(re, "**$1**"));
  return {
    ...r,
    experience: r.experience?.map((e) => ({ ...e, bullets: e.bullets.map(mark) })),
    projects: r.projects?.map((p) => ({ ...p, bullets: p.bullets.map(mark) })),
  };
}

const numbers = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?%?\+?/g) ?? []);

/**
 * AI tailoring: rewords the existing bullets toward the job description and reorders/extends skills.
 * Guard rails, checked in code (not just asked of the AI): the same jobs, titles, dates and number of
 * bullets; no number that isn't already on the resume; new skills only if the resume text already
 * mentions them. Anything that fails a check keeps the original text.
 */
export async function aiTailorResume(db: SupabaseClient, r: ParsedResume, job: { title: string; company: string; description: string }, userId?: string): Promise<ParsedResume> {
  const exp = r.experience ?? [];
  const proj = r.projects ?? [];
  const prompt = `You tailor a resume to one job without lying. Job: "${job.title}" at ${job.company}.
JOB DESCRIPTION: ${job.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3500)}
RESUME BULLETS (JSON): ${JSON.stringify({ experience: exp.map((e) => ({ company: e.company, title: e.title, bullets: e.bullets })), projects: proj.map((p) => ({ name: p.name, bullets: p.bullets })) })}
SKILLS: ${JSON.stringify(r.skill_groups?.length ? r.skill_groups : r.skills ?? [])}
RULES:
- Rewrite each bullet so it mirrors the job's wording and priorities where the original work honestly supports it. Keep the same facts, tools and numbers; never add a metric, tool, employer, title or achievement that isn't in that bullet or elsewhere on the resume.
- Same number of bullets per job/project, same order of jobs. Keep each bullet about the same length (the resume must stay one page).
- Mark the 1-3 most job-relevant phrases in each bullet with **double asterisks**.
- Skills: reorder so the job's most-wanted ones come first; keep the same groups.
Return JSON: {"experience":[{"bullets":[...]}...], "projects":[{"bullets":[...]}...], "skills": <same shape as SKILLS>}`;
  const out = await geminiJson<{ experience?: { bullets?: string[] }[]; projects?: { bullets?: string[] }[]; skills?: unknown }>(db, prompt, [], userId, { prefer: "fallback-only" });
  const allText = `${resumeToText(r)} ${(r.skills ?? []).join(" ")} ${(r.skill_groups ?? []).flatMap((g) => g.items).join(" ")}`.toLowerCase();
  const allNums = numbers(allText);
  const ok = (orig: string, next: unknown): string => {
    if (typeof next !== "string" || !next.trim()) return orig;
    const clean = next.trim();
    if (clean.replace(/\*\*/g, "").length > orig.replace(/\*\*/g, "").length * 1.25 + 20) return orig; // would push to a 2nd page
    for (const n of numbers(clean)) if (!allNums.has(n)) return orig; // invented metric
    return clean;
  };
  const mergeBullets = (orig: string[], next?: string[]) => (Array.isArray(next) && next.length === orig.length ? orig.map((b, i) => ok(b, next[i])) : orig);
  const known = (s: string) => allText.includes(s.toLowerCase().replace(/\*\*/g, ""));
  let skill_groups = r.skill_groups;
  let skills = r.skills;
  if (r.skill_groups?.length && Array.isArray(out.skills)) {
    const next = out.skills as { name?: string; items?: string[] }[];
    skill_groups = r.skill_groups.map((g) => {
      const match = next.find((n) => n?.name === g.name);
      const items = Array.isArray(match?.items) ? match!.items.filter((x) => typeof x === "string" && known(x)) : [];
      return items.length >= g.items.length * 0.8 ? { ...g, items: [...new Set(items)] } : g;
    });
  } else if (Array.isArray(out.skills) && out.skills.every((x) => typeof x === "string")) {
    const next = (out.skills as string[]).filter(known);
    if (next.length >= (r.skills?.length ?? 0) * 0.8) skills = [...new Set(next)];
  }
  return {
    ...r,
    skills,
    skill_groups,
    experience: exp.map((e, i) => ({ ...e, bullets: mergeBullets(e.bullets, out.experience?.[i]?.bullets) })),
    projects: proj.map((p, i) => ({ ...p, bullets: mergeBullets(p.bullets, out.projects?.[i]?.bullets) })),
  };
}
