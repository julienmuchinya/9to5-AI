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
  /** The resume the agent prefers when several fit a job about equally (and for jobs with no description). */
  default_id?: string;
}

/** The default resume's id: the one picked on the Resumes page, else the main (profile) resume, else the first. */
export const defaultResumeId = (lib: ResumeLibrary): string | undefined =>
  (lib.default_id && lib.resumes.some((r) => r.id === lib.default_id) ? lib.default_id : undefined) ??
  (lib.resumes.some((r) => r.id === "main") ? "main" : lib.resumes[0]?.id);

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
  // Resume PDFs uploaded while the list couldn't be saved (the bucket refused library.json) still show up,
  // as "not read yet" cards the user can read with one click — instead of being silently ignored.
  const { data: files } = await storage.storage.from("resumes").list(`${userId}/resumes`, { limit: 100 });
  for (const f of files ?? []) {
    const id = f.name.replace(/\.pdf$/i, "");
    if (!/^[a-z0-9]{1,12}$/.test(id) || id === "main" || others.some((r) => r.id === id)) continue;
    others.push({ id, label: "Uploaded resume", path: `${userId}/resumes/${f.name}`, parsed: null, uploaded_at: f.created_at ?? "" });
  }
  const mainLabel = lib.resumes.find((r) => r.id === "main")?.label ?? "Main resume";
  const main: ResumeEntry[] = profile.resume_path
    ? [{ id: "main", label: mainLabel, path: profile.resume_path, parsed: profile.resume_parsed ?? null, uploaded_at: profile.resume_updated_at ?? "" }]
    : [];
  return { resumes: [...main, ...others], default_id: lib.default_id };
}

export async function saveLibrary(storage: SupabaseClient, userId: string, lib: ResumeLibrary) {
  const body = JSON.stringify({ resumes: lib.resumes.map((r) => (r.id === "main" ? { ...r, parsed: null } : r)), default_id: lib.default_id });
  const put = (type: string) => storage.storage.from("resumes").upload(libraryPath(userId), new Blob([body], { type }), { upsert: true, contentType: type });
  let { error } = await put("application/json");
  // The "resumes" bucket only accepts PDFs, which refused library.json — so extra resumes were never saved.
  // Store the same JSON under the PDF type instead (it's only ever read back by this code). No setup change needed.
  if (error && /mime|content.?type/i.test(error.message)) ({ error } = await put("application/pdf"));
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

/** Technologies a job posting names, so coverage can be judged on what the job actually asks for. */
const TECH =
  "python java javascript typescript c c++ c# go golang rust ruby php swift kotlin scala r matlab sql nosql html css react angular vue svelte next.js node node.js express django flask fastapi spring rails .net asp.net graphql rest grpc aws azure gcp docker kubernetes terraform ansible jenkins ci/cd git linux unix bash powershell postgresql postgres mysql mongodb redis elasticsearch kafka rabbitmq spark hadoop airflow snowflake databricks pandas numpy pytorch tensorflow keras scikit-learn sklearn llm llms openai langchain rag nlp ml ai machine-learning deep-learning computer-vision opencv cuda embedded firmware rtos verilog vhdl fpga arm stm32 ros simulink labview sap salesforce tableau powerbi excel jira agile scrum microservices oop tdd junit pytest selenium playwright cypress jest unity unreal ios android flutter react-native xcode figma firebase supabase stripe oauth jwt security devops sre observability prometheus grafana datadog splunk sdlc api apis"
    .split(" ")
    .filter(Boolean);
const TECH_SET = new Set(TECH);

/**
 * Share (0–1) of the technologies the job names that the resume already has. 1 when the job names none.
 * Used to decide whether the original PDF goes out untouched (strong match) or gets tailored first.
 */
export function jobSkillCoverage(resume: ParsedResume | null, jobText: string): { coverage: number; missing: string[]; asked: string[] } {
  const asked = [...new Set(tokens(jobText).map((w) => w.replace(/[.,;:]+$/, "")).filter((w) => TECH_SET.has(w)))];
  if (!resume || !asked.length) return { coverage: resume ? 1 : 0, missing: [], asked };
  const mine = new Set(tokens(`${resumeToText(resume)} ${(resume.skills ?? []).join(" ")}`).map((w) => w.replace(/[.,;:]+$/, "")));
  const alias: Record<string, string[]> = { node: ["node.js", "nodejs"], "node.js": ["node", "nodejs"], golang: ["go"], go: ["golang"], postgres: ["postgresql"], postgresql: ["postgres"], sklearn: ["scikit-learn"], "scikit-learn": ["sklearn"], ml: ["machine-learning", "machine"], ai: ["artificial"], apis: ["api"], api: ["apis"], "ci/cd": ["ci", "cd"], llms: ["llm"], llm: ["llms"] };
  const has = (w: string) => mine.has(w) || (alias[w] ?? []).some((a) => mine.has(a));
  const missing = asked.filter((w) => !has(w));
  return { coverage: (asked.length - missing.length) / asked.length, missing, asked };
}

const TITLE_FILLER = /^(and|the|for|with|senior|sr|junior|jr|intern|internship|new|grad|graduate|level|entry|associate|ii|iii|iv|lead|staff|principal|remote|hybrid|onsite|part|time|full|temporary|contract|area|preferred|us|usa)$/;

/**
 * How well one resume fits one job, 0-100 — the number the agent shows and decides on.
 *   45% the technologies / tools the posting names that the resume has (all of them when it names none),
 *   35% how much of the posting's wording the resume covers (30% overlap already counts as full marks),
 *   20% the job title's words found on the resume (its titles, skills, target roles).
 * 60 or more: the resume goes out as the original PDF. Below 60 on every resume: the best one is tailored.
 */
export function resumeMatchScore(resume: ParsedResume | null, jobText: string): number {
  if (!resume) return 0;
  const [titleLine = ""] = jobText.split("\n");
  const cov = jobSkillCoverage(resume, jobText).coverage;
  const kw = Math.min(1, resumeJobScore(resume, jobText) / 0.3);
  const mine = `${resumeToText(resume)} ${(resume.target_roles ?? []).join(" ")} ${(resume.skills ?? []).join(" ")}`.toLowerCase();
  const words = (titleLine.toLowerCase().match(/[a-z][a-z+#.]{1,}/g) ?? []).filter((w) => w.length > 2 && !TITLE_FILLER.test(w));
  const title = words.length ? words.filter((w) => mine.includes(w)).length / words.length : 0.5;
  return Math.round(100 * (0.45 * cov + 0.35 * kw + 0.2 * title));
}

/** Below this match score on EVERY resume, the best one is tailored to the job (env RESUME_TAILOR_BELOW). */
export const TAILOR_BELOW = Number(process.env.RESUME_TAILOR_BELOW ?? "60") || 60;

/** Every usable resume scored for this job, best first. The default resume wins near-ties (within 3 points). */
export function rankResumes(lib: ResumeLibrary, jobText: string): { entry: ResumeEntry; score: number }[] {
  const usable = lib.resumes.filter((r) => r.parsed?.experience?.length || r.parsed?.skills?.length);
  const def = defaultResumeId(lib);
  if (!usable.length) {
    const fallback = lib.resumes.find((r) => r.id === def) ?? lib.resumes[0];
    return fallback ? [{ entry: fallback, score: 0 }] : [];
  }
  const bonus = (r: ResumeEntry) => (r.id === def ? 3 : 0);
  return usable
    .map((entry) => ({ entry, score: resumeMatchScore(entry.parsed, jobText) }))
    .sort((a, b) => b.score + bonus(b.entry) - (a.score + bonus(a.entry)));
}

/** The resume (of several) that best fits this job. */
export function pickResume(lib: ResumeLibrary, jobText: string): ResumeEntry | null {
  return rankResumes(lib, jobText)[0]?.entry ?? null;
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
  // Technologies the posting names that the resume lacks: the only new skills the AI may add (at most 4).
  const missing = jobSkillCoverage(r, `${job.title}\n${job.description}`).missing;
  const prompt = `You tailor a resume to one job. Only the WORDS change: the layout, sections, jobs, titles, dates and bullet count stay exactly the same. Job: "${job.title}" at ${job.company}.
JOB DESCRIPTION: ${job.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2500)}
RESUME BULLETS (JSON): ${JSON.stringify({ experience: exp.map((e) => ({ company: e.company, title: e.title, bullets: e.bullets })), projects: proj.map((p) => ({ name: p.name, bullets: p.bullets })) })}
SKILLS: ${JSON.stringify(r.skill_groups?.length ? r.skill_groups : r.skills ?? [])}
JOB TECHNOLOGIES NOT ON THE RESUME YET: ${JSON.stringify(missing.slice(0, 12))}
RULES:
- Bullet i of a job is ALWAYS about the same work as original bullet i — never move content between bullets, never merge or split them.
- XYZ style, written naturally: strong past-tense verb + the result / goal achieved (X) + how it was measured (Y) + "by" + what was done, naming the technology used (Z). Example: "Cut report build time 40% by automating SQL pipelines in Python and Airflow". Do NOT write the literal words "Accomplished" or "as measured by".
- If an original bullet already reads like that, keep it almost word for word and only swap in the job's own terms for the same thing (e.g. "LLM" -> "generative AI" when the job says that).
- Numbers: only the numbers already in that bullet. If it has none, name the concrete outcome in plain words; never invent a metric, a rate or a measurement.
- Technologies: only those already in that bullet or in the same job's other bullets. Never attach a tool to work that didn't use it. Never add an employer, title, degree or achievement.
- Same number of bullets per job/project, same order. Keep each bullet about the same length as the original (the resume must stay one page).
- Mark the 1-3 most job-relevant phrases in each bullet with **double asterisks**.
- Skills: reorder so the job's most-wanted ones come first; keep the same groups. You MAY add up to 4 items from JOB TECHNOLOGIES NOT ON THE RESUME YET, only ones closely related to what the resume already shows (e.g. PostgreSQL next to MySQL, Azure next to AWS), into the group they belong to.
Return JSON: {"experience":[{"bullets":[...]}...], "projects":[{"bullets":[...]}...], "skills": <same shape as SKILLS>}`;
  const out = await geminiJson<{ experience?: { bullets?: string[] }[]; projects?: { bullets?: string[] }[]; skills?: unknown }>(db, prompt, [], userId, { prefer: "fallback-only", maxTokens: 1500 });
  const allText = `${resumeToText(r)} ${(r.skills ?? []).join(" ")} ${(r.skill_groups ?? []).flatMap((g) => g.items).join(" ")}`.toLowerCase();
  const techIn = (t: string) => new Set(tokens(t.replace(/\*\*/g, "")).map((w) => w.replace(/[.,;:]+$/, "")).filter((w) => TECH_SET.has(w)));
  const words = (t: string) => new Set(tokens(t.replace(/\*\*/g, "")).filter((w) => w.length > 3 && !/^\d/.test(w)));
  /** Checked in code, not just asked of the AI: a rewrite that fails any check keeps the original bullet. */
  const ok = (orig: string, next: unknown, sameEntry: string): string => {
    const r = check(orig, next, sameEntry);
    if (process.env.TAILOR_DEBUG && r.why) console.log(`[tailor] kept original (${r.why}): ${String(next).slice(0, 140)}`);
    return r.text;
  };
  const check = (orig: string, next: unknown, sameEntry: string): { text: string; why?: string } => {
    const keep = (why: string) => ({ text: orig, why });
    if (typeof next !== "string" || !next.trim()) return keep("empty");
    const clean = next.trim();
    const plain = clean.replace(/\*\*/g, "");
    if (plain.length > orig.replace(/\*\*/g, "").length * 1.25 + 20) return keep("too long for one page");
    if (/^accomplished\b|as measured by/i.test(plain)) return keep("template wording");
    const own = numbers(orig);
    for (const n of numbers(clean)) if (!own.has(n)) return keep(`new number ${n}`);
    const entryTech = techIn(sameEntry);
    for (const t of techIn(clean)) if (!entryTech.has(t)) return keep(`tool not used in this job: ${t}`);
    // Still about the same work: at least 40% of the original's words survive (the AI moved bullets around).
    const o = words(orig);
    const n = words(clean);
    if (o.size >= 4 && [...o].filter((w) => n.has(w)).length / o.size < 0.4) return keep("different work");
    return { text: clean };
  };
  const mergeBullets = (orig: string[], next: string[] | undefined, extra = "") => {
    if (!Array.isArray(next) || next.length !== orig.length) return orig;
    const sameEntry = `${orig.join(" ")} ${extra}`;
    return orig.map((b, i) => ok(b, next[i], sameEntry));
  };
  // A skill may stay if the resume already mentions it, or if it is one of the job's named, concrete
  // technologies (max 4 added) — not vague ones like "security" or "agile".
  const VAGUE = /^(security|observability|api|apis|sdlc|agile|scrum|devops|sre|oop|tdd|ai|ml|llm|llms|nlp|rag|machine-learning|deep-learning|computer-vision|microservices|rest|ci\/cd|git|linux|unix|excel)$/;
  const allowedNew = new Set(missing.map((m) => m.toLowerCase()).filter((m) => !VAGUE.test(m)));
  let added = 0;
  const known = (s: string) => {
    const k = s.toLowerCase().replace(/\*\*/g, "").trim();
    if (allText.includes(k)) return true;
    if (allowedNew.has(k) && added < 4) {
      added++;
      return true;
    }
    return false;
  };
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
    experience: exp.map((e, i) => ({ ...e, bullets: mergeBullets(e.bullets, out.experience?.[i]?.bullets, e.title) })),
    projects: proj.map((p, i) => ({ ...p, bullets: mergeBullets(p.bullets, out.projects?.[i]?.bullets, `${p.name} ${(p.tech ?? []).join(" ")}`) })),
  };
}
