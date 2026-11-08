/**
 * How long has the employer's website existed? Looked up in the public domain registry (RDAP, free,
 * no key). Real employers are rarely brand-new domains; scam "companies" usually are.
 * Only used for postings outside vetted sources (remote job feeds, an employer's own careers site).
 */
import { AGGREGATOR_HOSTS } from "./discovery/resolve";

const ATS_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkday(jobs|site)\.com|workable\.com|rippling\.com|smartrecruiters\.com|icims\.com|jobvite\.com|eightfold\.ai|taleo\.net|successfactors\.(com|eu)|oraclecloud\.com|bamboohr\.com|breezy\.hr|recruitee\.com|jazzhr\.com|applytojob\.com|paylocity\.com|adp\.com|ultipro\.com|ukg\.net|jibeapply\.com)$/i;
const TWO_PART_TLDS = /\.(co|com|org|net|ac|gov)\.[a-z]{2}$/i;

/** "careers.rivian.com/jobs/1" → "rivian.com"; null for hiring systems and job boards (no employer domain there). */
export function employerDomain(url: string | null | undefined): string | null {
  let host: string;
  try {
    host = new URL(url ?? "").hostname.toLowerCase();
  } catch {
    return null;
  }
  if (ATS_HOSTS.test(host) || AGGREGATOR_HOSTS.test(host)) return null;
  const parts = host.split(".");
  return parts.slice(TWO_PART_TLDS.test(host) ? -3 : -2).join(".");
}

const cache = new Map<string, number | null>();

/** Years since the domain was registered, or null when the registry doesn't say. */
export async function domainAgeYears(domain: string, timeoutMs = 8000): Promise<number | null> {
  if (cache.has(domain)) return cache.get(domain)!;
  let years: number | null = null;
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/rdap+json" } });
    if (res.ok) {
      const j = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
      const reg = j.events?.find((e) => e.eventAction === "registration")?.eventDate;
      if (reg) years = Math.round(((Date.now() - Date.parse(reg)) / (365.25 * 86400_000)) * 10) / 10;
    }
  } catch {
    // registry slow or unknown TLD: no signal either way
  }
  cache.set(domain, years);
  return years;
}
