import {
  atsFromUrl,
  detectLevel,
  domainOf,
  isGeorgia,
  isRemoteText,
  isStemTitle,
  isUsLocation,
  isUsRemote,
  parseSalary,
  stripHtml,
  type JobLevel,
} from "./filters";

export interface Posting {
  source: string;
  source_key: string;
  company_name: string;
  company_domain?: string;
  title: string;
  level: JobLevel;
  locations: string[];
  is_remote: boolean;
  url: string;
  apply_url?: string;
  ats?: string;
  ats_board?: string;
  salary_min?: number;
  salary_max?: number;
  description?: string;
  posted_at?: string;
}

const UA = { "User-Agent": "9to5-ai-job-agent (personal job search; contact via GitHub)" };
const MAX_AGE_DAYS = 45;
const DESC_MAX = 3500;

async function getJson<T>(url: string, timeoutMs = 30000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const recent = (iso?: string) =>
  !iso || Date.now() - new Date(iso).getTime() < MAX_AGE_DAYS * 86400_000;

/** Keep only STEM jobs located in (or remote-open to) the US. */
export function keepPosting(p: Posting): boolean {
  if (!isStemTitle(p.title)) return false;
  if (!recent(p.posted_at)) return false;
  const locs = p.locations.join(" | ");
  if (p.is_remote) return isUsRemote(locs) || p.locations.some(isUsLocation);
  return p.locations.some((l) => isUsLocation(l) || isGeorgia(l));
}

function finish(p: Posting): Posting {
  const { ats, board } = atsFromUrl(p.apply_url || p.url);
  return {
    ...p,
    ats: p.ats ?? ats,
    ats_board: p.ats_board ?? board,
    description: p.description?.slice(0, DESC_MAX),
  };
}

// ── SimplifyJobs internship + new-grad lists (GitHub, free, daily) ─────────
interface SimplifyRow {
  company_name: string;
  title: string;
  url: string;
  locations: string[];
  active: boolean;
  is_visible?: boolean;
  date_posted: number;
  id: string;
  sponsorship?: string;
  terms?: string[];
}

export async function fetchSimplify(kind: "internships" | "new_grad"): Promise<Posting[]> {
  const repo = kind === "internships" ? "Summer2026-Internships" : "New-Grad-Positions";
  const rows = await getJson<SimplifyRow[]>(
    `https://raw.githubusercontent.com/SimplifyJobs/${repo}/dev/.github/scripts/listings.json`,
    90000
  );
  if (!rows) return [];
  return rows
    .filter((r) => r.active && r.is_visible !== false && r.url)
    .map((r) =>
      finish({
        source: `simplify_${kind}`,
        source_key: `simplify:${r.id}`,
        company_name: r.company_name,
        title: r.title,
        level: kind === "internships" ? "internship" : detectLevel(r.title) === "senior" ? "senior" : "new_grad",
        locations: r.locations ?? [],
        is_remote: (r.locations ?? []).some(isRemoteText),
        url: r.url,
        apply_url: r.url,
        posted_at: r.date_posted ? new Date(r.date_posted * 1000).toISOString() : undefined,
        description: [r.terms?.join(", "), r.sponsorship ? `Sponsorship: ${r.sponsorship}` : ""]
          .filter(Boolean)
          .join("\n"),
      })
    )
    .filter(keepPosting);
}

// ── Company job boards (Greenhouse / Lever / Ashby public APIs) ────────────
interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  first_published?: string;
  updated_at?: string;
  company_name?: string;
}

export async function fetchGreenhouse(board: string): Promise<Posting[]> {
  const data = await getJson<{ jobs: GhJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`
  );
  if (!data?.jobs) return [];
  return data.jobs
    .map((j) => {
      const desc = stripHtml(j.content ?? "");
      const loc = j.location?.name ?? "";
      const pay = parseSalary(desc);
      return finish({
        source: "greenhouse",
        source_key: `greenhouse:${board}:${j.id}`,
        company_name: j.company_name || board,
        title: j.title,
        level: detectLevel(j.title, desc.slice(0, 400)),
        locations: loc ? loc.split(/;|\s\|\s/).map((s) => s.trim()) : [],
        is_remote: isRemoteText(loc),
        url: j.absolute_url,
        apply_url: j.absolute_url,
        ats: "greenhouse",
        ats_board: board,
        salary_min: pay.min,
        salary_max: pay.max,
        description: desc,
        posted_at: j.first_published ?? j.updated_at,
      });
    })
    .filter(keepPosting);
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  createdAt: number;
  categories?: { location?: string; allLocations?: string[]; commitment?: string };
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; interval?: string };
  descriptionPlain?: string;
  additionalPlain?: string;
}

export async function fetchLever(board: string): Promise<Posting[]> {
  const data = await getJson<LeverJob[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((j) => {
      const desc = `${j.descriptionPlain ?? ""}\n${j.additionalPlain ?? ""}`;
      const hourly = /hour/i.test(j.salaryRange?.interval ?? "");
      const pay = j.salaryRange?.max
        ? {
            min: j.salaryRange.min ? j.salaryRange.min * (hourly ? 2080 : 1) : undefined,
            max: j.salaryRange.max * (hourly ? 2080 : 1),
          }
        : parseSalary(desc);
      const locs = j.categories?.allLocations?.length
        ? j.categories.allLocations
        : j.categories?.location
          ? [j.categories.location]
          : [];
      return finish({
        source: "lever",
        source_key: `lever:${board}:${j.id}`,
        company_name: board,
        title: j.text,
        level: detectLevel(j.text, j.categories?.commitment ?? ""),
        locations: locs,
        is_remote: j.workplaceType === "remote" || locs.some(isRemoteText),
        url: j.hostedUrl,
        apply_url: j.applyUrl,
        ats: "lever",
        ats_board: board,
        salary_min: pay.min,
        salary_max: pay.max,
        description: desc,
        posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      });
    })
    .filter(keepPosting);
}

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean;
  workplaceType?: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  isListed?: boolean;
  employmentType?: string;
  compensation?: { scrapeableCompensationSalarySummary?: string; compensationTierSummary?: string };
}

export async function fetchAshby(board: string): Promise<Posting[]> {
  const data = await getJson<{ jobs: AshbyJob[]; apiVersion?: string }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`
  );
  if (!data?.jobs) return [];
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const locs = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean) as string[];
      const comp = j.compensation?.scrapeableCompensationSalarySummary ?? j.compensation?.compensationTierSummary ?? "";
      const pay = parseSalary(comp) ?? {};
      const fallback = pay.max ? pay : parseSalary(j.descriptionPlain ?? "");
      return finish({
        source: "ashby",
        source_key: `ashby:${board}:${j.id}`,
        company_name: board,
        title: j.title,
        level: detectLevel(j.title, j.employmentType ?? ""),
        locations: locs,
        is_remote: Boolean(j.isRemote) || j.workplaceType === "Remote",
        url: j.jobUrl,
        apply_url: j.applyUrl ?? `${j.jobUrl}/application`,
        ats: "ashby",
        ats_board: board,
        salary_min: fallback.min,
        salary_max: fallback.max,
        description: j.descriptionPlain,
        posted_at: j.publishedAt,
      });
    })
    .filter(keepPosting);
}

// ── Remote job feeds ───────────────────────────────────────────────────────
export async function fetchRemoteFeeds(): Promise<Posting[]> {
  const out: Posting[] = [];

  const remotive = await getJson<{
    jobs: { id: number; title: string; company_name: string; url: string; candidate_required_location: string; salary: string; publication_date: string; description: string; job_type: string }[];
  }>("https://remotive.com/api/remote-jobs?category=software-dev&limit=150");
  for (const j of remotive?.jobs ?? []) {
    const desc = stripHtml(j.description);
    const pay = parseSalary(j.salary || desc);
    out.push(
      finish({
        source: "remotive",
        source_key: `remotive:${j.id}`,
        company_name: j.company_name,
        title: j.title,
        level: detectLevel(j.title, j.job_type),
        locations: [j.candidate_required_location || "Remote"],
        is_remote: true,
        url: j.url,
        salary_min: pay.min,
        salary_max: pay.max,
        description: desc,
        posted_at: j.publication_date,
      })
    );
  }

  const jobicy = await getJson<{
    jobs: { id: number; jobTitle: string; companyName: string; url: string; jobGeo: string; annualSalaryMin?: number; annualSalaryMax?: number; pubDate: string; jobDescription: string; jobLevel?: string }[];
  }>("https://jobicy.com/api/v2/remote-jobs?count=100&geo=usa");
  for (const j of jobicy?.jobs ?? []) {
    out.push(
      finish({
        source: "jobicy",
        source_key: `jobicy:${j.id}`,
        company_name: j.companyName,
        title: j.jobTitle,
        level: detectLevel(j.jobTitle, j.jobLevel ?? ""),
        locations: [j.jobGeo || "USA"],
        is_remote: true,
        url: j.url,
        salary_min: j.annualSalaryMin,
        salary_max: j.annualSalaryMax,
        description: stripHtml(j.jobDescription ?? ""),
        posted_at: j.pubDate,
      })
    );
  }

  const remoteok = await getJson<
    { id?: string; position?: string; company?: string; url?: string; apply_url?: string; location?: string; salary_min?: number; salary_max?: number; date?: string; description?: string }[]
  >("https://remoteok.com/api");
  for (const j of (remoteok ?? []).slice(1)) {
    if (!j.id || !j.position || !j.url) continue;
    out.push(
      finish({
        source: "remoteok",
        source_key: `remoteok:${j.id}`,
        company_name: j.company ?? "Unknown",
        title: j.position,
        level: detectLevel(j.position),
        locations: [j.location || "Remote"],
        is_remote: true,
        url: j.url,
        apply_url: j.apply_url,
        salary_min: j.salary_min || undefined,
        salary_max: j.salary_max || undefined,
        description: stripHtml(j.description ?? ""),
        posted_at: j.date,
      })
    );
  }

  for (const level of ["Entry Level", "Internship"]) {
    const muse = await getJson<{
      results: { id: number; name: string; company: { name: string }; refs: { landing_page: string }; locations: { name: string }[]; publication_date: string; contents: string }[];
    }>(`https://www.themuse.com/api/public/jobs?category=Software%20Engineering&category=Data%20and%20Analytics&level=${encodeURIComponent(level)}&page=0`);
    for (const j of muse?.results ?? []) {
      const locs = j.locations.map((l) => l.name);
      const desc = stripHtml(j.contents ?? "");
      const pay = parseSalary(desc);
      out.push(
        finish({
          source: "themuse",
          source_key: `themuse:${j.id}`,
          company_name: j.company.name,
          title: j.name,
          level: level === "Internship" ? "internship" : "entry",
          locations: locs,
          is_remote: locs.some(isRemoteText),
          url: j.refs.landing_page,
          salary_min: pay.min,
          salary_max: pay.max,
          description: desc,
          posted_at: j.publication_date,
        })
      );
    }
  }

  return out.filter(keepPosting);
}

/** Company job boards found in the Simplify lists — the agent discovers companies itself. */
export function boardsFrom(postings: Posting[]): { ats: "greenhouse" | "lever" | "ashby"; board: string }[] {
  const seen = new Map<string, { ats: "greenhouse" | "lever" | "ashby"; board: string }>();
  for (const p of postings) {
    if (!p.ats_board) continue;
    if (p.ats === "greenhouse" || p.ats === "lever" || p.ats === "ashby") {
      const key = `${p.ats}:${p.ats_board.toLowerCase()}`;
      if (!seen.has(key)) seen.set(key, { ats: p.ats, board: p.ats_board });
    }
  }
  return [...seen.values()].sort((a, b) => `${a.ats}${a.board}`.localeCompare(`${b.ats}${b.board}`));
}

export { domainOf };
