import { detectLevel, isUsLocation, parseSalary, stripHtml } from "./filters";
import type { Posting } from "./sources";

/**
 * Employers' Workday career sites, searched by keyword through Workday's public job-search JSON
 * (the same calls the career page makes; no key). Used for the roles the user asks for — oil & gas,
 * offshore, pipelines, mining, utilities — which aren't on the tech boards (Greenhouse / Lever / Ashby).
 * The agent applies on Workday itself. A board that stops answering just returns nothing.
 * Checked Nov 2026: every entry below answered 200 (61 employers).
 */
export interface WorkdayBoard {
  company: string;
  /** e.g. "noblecorp.wd1" (the part before .myworkdayjobs.com) */
  host: string;
  tenant: string;
  site: string;
  /** Searched on every run with an empty query (newest first), not only for the user's roles. */
  sector: "energy" | "mining" | "utilities" | "industrial" | "retail" | "finance" | "healthcare" | "government" | "tech" | "services";
}

export const WORKDAY_BOARDS: WorkdayBoard[] = [
  { company: "Transocean", host: "deepwater.wd1", tenant: "deepwater", site: "GlobalExternalCareerSite", sector: "energy" },
  { company: "Noble Corporation", host: "noblecorp.wd1", tenant: "noblecorp", site: "noblecorp", sector: "energy" },
  { company: "Helmerich & Payne", host: "hpinc.wd5", tenant: "hpinc", site: "HPINC", sector: "energy" },
  { company: "Diamondback Energy", host: "diamondbackenergy.wd12", tenant: "diamondbackenergy", site: "DBE", sector: "energy" },
  { company: "ProPetro", host: "propetroservices.wd5", tenant: "propetroservices", site: "PROPWR_Careers", sector: "energy" },
  { company: "Chevron", host: "chevron.wd5", tenant: "chevron", site: "jobs", sector: "energy" },
  { company: "Shell", host: "shell.wd3", tenant: "shell", site: "ShellCareers", sector: "energy" },
  { company: "ConocoPhillips", host: "conocophillips.wd1", tenant: "conocophillips", site: "External", sector: "energy" },
  { company: "Baker Hughes", host: "bakerhughes.wd5", tenant: "bakerhughes", site: "BakerHughes", sector: "energy" },
  { company: "Marathon Petroleum", host: "mpc.wd1", tenant: "mpc", site: "MPCCareers", sector: "energy" },
  { company: "ONEOK", host: "oneok.wd1", tenant: "oneok", site: "ONEOK", sector: "energy" },
  { company: "Williams", host: "williams.wd5", tenant: "williams", site: "External", sector: "energy" },
  { company: "Plains All American", host: "plains.wd1", tenant: "plains", site: "Plains", sector: "energy" },
  { company: "Enbridge", host: "enbridge.wd3", tenant: "enbridge", site: "enbridge_careers", sector: "energy" },
  { company: "TC Energy", host: "tcenergy.wd3", tenant: "tcenergy", site: "CAREER_SITE_TC", sector: "energy" },
  { company: "Harvest Midstream", host: "hec.wd5", tenant: "hec", site: "harvest_midstream", sector: "energy" },
  { company: "NGL Energy Partners", host: "nglenergypartners.wd5", tenant: "nglenergypartners", site: "jobs", sector: "energy" },
  { company: "KBR", host: "kbr.wd5", tenant: "kbr", site: "KBR_Careers", sector: "industrial" },
  { company: "Dow", host: "dow.wd1", tenant: "dow", site: "ExternalCareers", sector: "industrial" },
  { company: "Waste Connections", host: "wasteconnections.wd1", tenant: "wasteconnections", site: "Careers", sector: "utilities" },
  // Every other field: retail, banking & insurance, healthcare, government contractors, tech, services.
  { company: "Target", host: "target.wd5", tenant: "target", site: "targetcareers", sector: "retail" },
  { company: "Lowe's", host: "lowes.wd5", tenant: "lowes", site: "LWS_External_CS", sector: "retail" },
  { company: "The Home Depot", host: "homedepot.wd5", tenant: "homedepot", site: "CareerDepot", sector: "retail" },
  { company: "Nike", host: "nike.wd1", tenant: "nike", site: "nke", sector: "retail" },
  { company: "Bank of America", host: "ghr.wd1", tenant: "ghr", site: "Lateral-US", sector: "finance" },
  { company: "Wells Fargo", host: "wf.wd1", tenant: "wf", site: "WellsFargoJobs", sector: "finance" },
  { company: "Capital One", host: "capitalone.wd12", tenant: "capitalone", site: "Capital_One", sector: "finance" },
  { company: "U.S. Bank", host: "usbank.wd1", tenant: "usbank", site: "US_Bank_Careers", sector: "finance" },
  { company: "PNC", host: "pnc.wd5", tenant: "pnc", site: "External", sector: "finance" },
  { company: "Truist", host: "truist.wd1", tenant: "truist", site: "Careers", sector: "finance" },
  { company: "State Street", host: "statestreet.wd1", tenant: "statestreet", site: "Global", sector: "finance" },
  { company: "Mastercard", host: "mastercard.wd1", tenant: "mastercard", site: "CorporateCareers", sector: "finance" },
  { company: "PayPal", host: "paypal.wd1", tenant: "paypal", site: "jobs", sector: "finance" },
  { company: "Travelers", host: "travelers.wd5", tenant: "travelers", site: "External", sector: "finance" },
  { company: "Allstate", host: "allstate.wd5", tenant: "allstate", site: "allstate_careers", sector: "finance" },
  { company: "GEICO", host: "geico.wd1", tenant: "geico", site: "External", sector: "finance" },
  { company: "PwC", host: "pwc.wd3", tenant: "pwc", site: "US_Experienced_Careers", sector: "finance" },
  { company: "CVS Health", host: "cvshealth.wd1", tenant: "cvshealth", site: "CVS_Health_Careers", sector: "healthcare" },
  { company: "Humana", host: "humana.wd5", tenant: "humana", site: "Humana_External_Career_Site", sector: "healthcare" },
  { company: "Cigna", host: "cigna.wd5", tenant: "cigna", site: "cignacareers", sector: "healthcare" },
  { company: "Elevance Health", host: "elevancehealth.wd1", tenant: "elevancehealth", site: "ANT", sector: "healthcare" },
  { company: "Centene", host: "centene.wd5", tenant: "centene", site: "Centene_External", sector: "healthcare" },
  { company: "Pfizer", host: "pfizer.wd1", tenant: "pfizer", site: "PfizerCareers", sector: "healthcare" },
  { company: "Abbott", host: "abbott.wd5", tenant: "abbott", site: "abbottcareers", sector: "healthcare" },
  { company: "Medtronic", host: "medtronic.wd1", tenant: "medtronic", site: "MedtronicCareers", sector: "healthcare" },
  { company: "GE HealthCare", host: "gehc.wd5", tenant: "gehc", site: "GEHC_ExternalSite", sector: "healthcare" },
  { company: "Cardinal Health", host: "cardinalhealth.wd1", tenant: "cardinalhealth", site: "EXT", sector: "healthcare" },
  { company: "Labcorp", host: "labcorp.wd1", tenant: "labcorp", site: "External", sector: "healthcare" },
  { company: "Boeing", host: "boeing.wd1", tenant: "boeing", site: "EXTERNAL_CAREERS", sector: "industrial" },
  { company: "3M", host: "3m.wd1", tenant: "3m", site: "Search", sector: "industrial" },
  { company: "Leidos", host: "leidos.wd5", tenant: "leidos", site: "External", sector: "government" },
  { company: "GDIT", host: "gdit.wd5", tenant: "gdit", site: "External_Career_Site", sector: "government" },
  { company: "CACI", host: "caci.wd1", tenant: "caci", site: "External", sector: "government" },
  { company: "Salesforce", host: "salesforce.wd12", tenant: "salesforce", site: "External_Career_Site", sector: "tech" },
  { company: "NVIDIA", host: "nvidia.wd5", tenant: "nvidia", site: "NVIDIAExternalCareerSite", sector: "tech" },
  { company: "Intel", host: "intel.wd1", tenant: "intel", site: "External", sector: "tech" },
  { company: "Adobe", host: "adobe.wd5", tenant: "adobe", site: "external_experienced", sector: "tech" },
  { company: "Verizon", host: "verizon.wd12", tenant: "verizon", site: "verizon-careers", sector: "tech" },
  { company: "T-Mobile", host: "tmobile.wd1", tenant: "tmobile", site: "External", sector: "tech" },
  { company: "JLL", host: "jll.wd1", tenant: "jll", site: "jllcareers", sector: "services" },
  { company: "Disney", host: "disney.wd5", tenant: "disney", site: "disneycareer", sector: "services" },
];

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" };

/** "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" → days, or null. */
export function postedDaysAgo(postedOn: string | undefined | null): number | null {
  const s = (postedOn ?? "").toLowerCase();
  if (!s) return null;
  if (/today|just posted|hour/.test(s)) return 0;
  if (/yesterday/.test(s)) return 1;
  const m = s.match(/(\d+)\+?\s*days?/);
  return m ? Number(m[1]) + (/\+/.test(s) ? 1 : 0) : null;
}

interface ListRow {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
}
interface Detail {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    startDate?: string;
    timeType?: string;
    country?: { descriptor?: string };
    jobRequisitionLocation?: { country?: { alpha2Code?: string; descriptor?: string } };
    externalUrl?: string;
    canApply?: boolean;
  };
}

const base = (b: WorkdayBoard) => `https://${b.host}.myworkdayjobs.com/wday/cxs/${b.tenant}/${b.site}`;

async function listJobs(b: WorkdayBoard, searchText: string, limit: number): Promise<ListRow[]> {
  try {
    const res = await fetch(`${base(b)}/jobs`, {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: Math.min(20, limit), offset: 0, searchText }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    return ((await res.json()) as { jobPostings?: ListRow[] }).jobPostings ?? [];
  } catch {
    return [];
  }
}

async function jobDetail(b: WorkdayBoard, path: string): Promise<Detail["jobPostingInfo"] | null> {
  try {
    const res = await fetch(`${base(b)}${path}`, { headers: { ...UA, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return ((await res.json()) as Detail).jobPostingInfo ?? null;
  } catch {
    return null;
  }
}

export const workdayKey = (b: WorkdayBoard, path: string) => `workday:${b.tenant}:${path.split("/").pop()}`;

/**
 * Postings on one Workday board for each query ("" = newest), no older than `maxAgeDays`, US only.
 * `skip(sourceKey)` → true for postings already saved (their details aren't fetched again).
 */
export async function fetchWorkdayBoard(
  b: WorkdayBoard,
  queries: string[],
  opts: { maxAgeDays: number; perQuery?: number; skip?: (key: string) => boolean; keepTitle?: (title: string) => boolean }
): Promise<Posting[]> {
  const rows = new Map<string, ListRow>();
  // All searches on one board at once (each is one small request).
  const lists = await Promise.all(queries.map((q) => listJobs(b, q, opts.perQuery ?? 20)));
  for (const list of lists) {
    for (const r of list) {
      const d = postedDaysAgo(r.postedOn);
      if (d != null && d > opts.maxAgeDays) continue;
      if (opts.keepTitle && !opts.keepTitle(r.title)) continue;
      if (!rows.has(r.externalPath)) rows.set(r.externalPath, r);
    }
  }
  const out: Posting[] = [];
  const todo = [...rows.values()].filter((r) => !opts.skip?.(workdayKey(b, r.externalPath)));
  // Details 6 at a time per board.
  const details = new Map<string, Awaited<ReturnType<typeof jobDetail>>>();
  for (let i = 0; i < todo.length; i += 6) {
    const part = todo.slice(i, i + 6);
    const got = await Promise.all(part.map((r) => jobDetail(b, r.externalPath)));
    part.forEach((r, j) => details.set(r.externalPath, got[j]));
  }
  for (const r of todo) {
    const key = workdayKey(b, r.externalPath);
    const info = details.get(r.externalPath);
    if (!info || info.canApply === false) continue;
    const country = info.jobRequisitionLocation?.country?.alpha2Code ?? "";
    const countryName = info.country?.descriptor ?? info.jobRequisitionLocation?.country?.descriptor ?? "";
    const locs = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean) as string[];
    const us = country === "US" || /united states/i.test(countryName) || locs.some(isUsLocation) || /gulf of (mexico|america)/i.test(locs.join(" "));
    if (!us) continue;
    const desc = stripHtml(info.jobDescription ?? "");
    const pay = parseSalary(desc);
    const days = postedDaysAgo(r.postedOn);
    const posted = info.startDate && /^\d{4}-\d{2}-\d{2}/.test(info.startDate) ? new Date(`${info.startDate.slice(0, 10)}T12:00:00Z`).toISOString() : days != null ? new Date(Date.now() - days * 86400_000).toISOString() : undefined;
    const url = info.externalUrl ?? `https://${b.host}.myworkdayjobs.com/${b.site}${r.externalPath}`;
    out.push({
      source: "workday",
      source_key: key,
      company_name: b.company,
      title: info.title ?? r.title,
      level: detectLevel(info.title ?? r.title, desc.slice(0, 400)),
      // Rig names ("Noble Endeavor") and "Gulf of Mexico" say nothing to the US filters: add the country.
      locations: locs.map((l) => (isUsLocation(l) ? l : `${l}, United States`)),
      is_remote: /\bremote\b/i.test(locs.join(" ")),
      url,
      apply_url: url,
      ats: "workday",
      ats_board: `${b.host}/${b.site}`,
      salary_min: pay.min,
      salary_max: pay.max,
      description: desc,
      posted_at: posted,
    });
  }
  return out;
}
