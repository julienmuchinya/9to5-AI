import { atsFromUrl } from "./filters";

/**
 * Job boards (The Muse, Simplify, Built In…) often link to the employer's real application page.
 * The agent can apply on Greenhouse / Lever / Ashby / Workday / Workable itself, so when a board page
 * shows such a link, use it. One plain HTTP request per posting, no AI. Boards that hide the link
 * behind scripts or a login (RemoteOK, Jobicy) are left as they are.
 */
export const AGGREGATOR_HOSTS = /(^|\.)(themuse\.com|simplify\.jobs|builtin\.com|builtin[a-z]+\.com|weworkremotely\.com|remotive\.com|wellfound\.com|ycombinator\.com|workatastartup\.com|dice\.com|ziprecruiter\.com|glassdoor\.com|indeed\.com)$/i;

const ATS_LINK = /https?:\/\/(?:[a-z0-9-]+\.)*(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|apply\.workable\.com)\/[^"'\s<>\)]+/gi;

export function isAggregator(url: string | null | undefined): boolean {
  try {
    return AGGREGATOR_HOSTS.test(new URL(url ?? "").hostname);
  } catch {
    return false;
  }
}

/** The first employer ATS link in a page's HTML (decoded), or null. Exported for tests. */
export function findAtsLink(html: string): string | null {
  const decoded = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&"); // JSON escapes \u002F and \/
  for (const m of decoded.matchAll(ATS_LINK)) {
    const url = m[0].split(String.fromCharCode(92))[0].replace(/[.,;]+$/, ""); // cut at a backslash (escaped JSON)
    // Skip generic pages (embed scripts, a company's whole board) — we want one job.
    if (/\/(embed\/js|static|assets)\b/i.test(url)) continue;
    if (/greenhouse\.io\/[^/]+\/?$|lever\.co\/[^/]+\/?$|ashbyhq\.com\/[^/]+\/?$/i.test(url)) continue;
    return url;
  }
  return null;
}

/** Real application link for a job-board posting, or null when the page doesn't show one. */
export async function resolveDirectLink(url: string, timeoutMs = 10_000): Promise<{ url: string; ats: string } | null> {
  if (!isAggregator(url)) return null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" },
    });
    if (!res.ok) return null;
    const direct = findAtsLink((await res.text()).slice(0, 800_000));
    if (!direct) return null;
    const ats = /apply\.workable\.com/i.test(direct) ? "other" : atsFromUrl(direct).ats;
    return { url: direct, ats };
  } catch {
    return null;
  }
}
