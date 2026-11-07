/**
 * The agent learns which application routes work, from the user's own history:
 * per site (one company's board, e.g. "job-boards.greenhouse.io/acme") and per family
 * (greenhouse / lever / ashby / workday / workable / other).
 *
 * - success = the application went through (submitted or any later stage);
 * - a miss  = it landed in Needs-you or failed; closed postings don't count against a route.
 * Rates are smoothed toward the family's rate, so a site with 1 try isn't judged on luck.
 * Used to (1) order the queue — routes that work go first, (2) skip routes that keep failing
 * (no time or AI spent on them), and (3) prefer another route to the same job when one exists.
 */

export type Family = "greenhouse" | "lever" | "ashby" | "workday" | "workable" | "other";

export function familyOf(url: string | null | undefined): Family {
  const u = (url ?? "").toLowerCase();
  if (/greenhouse\.io/.test(u)) return "greenhouse";
  if (/lever\.co/.test(u)) return "lever";
  if (/ashbyhq\.com/.test(u)) return "ashby";
  if (/myworkday(jobs|site)\.com/.test(u)) return "workday";
  if (/apply\.workable\.com/.test(u)) return "workable";
  return "other";
}

/** "job-boards.greenhouse.io/acme" — one company's board. */
export function siteOf(url: string | null | undefined): string {
  try {
    const x = new URL(url ?? "");
    return `${x.hostname.toLowerCase()}/${x.pathname.split("/").filter(Boolean)[0] ?? ""}`;
  } catch {
    return "";
  }
}

const SUCCESS = new Set(["submitted", "received", "under_review", "interview", "offer", "rejected", "withdrawn"]);
const MISS = new Set(["needs_user", "failed"]);

export interface RouteStats {
  tries: number;
  sent: number;
  /** Smoothed success rate 0..1. */
  rate: number;
}
export interface Learned {
  bySite: Map<string, RouteStats>;
  byFamily: Map<Family, RouteStats>;
}

/** Rows: the user's applications (apply_url, status, submitted_at). */
export function learnRoutes(rows: { apply_url: string | null; status: string; submitted_at?: string | null }[]): Learned {
  const fam = new Map<Family, { tries: number; sent: number }>();
  const site = new Map<string, { tries: number; sent: number; family: Family }>();
  for (const r of rows) {
    const ok = Boolean(r.submitted_at) || SUCCESS.has(r.status);
    if (!ok && !MISS.has(r.status)) continue; // queued / closed: no verdict on the route
    const f = familyOf(r.apply_url);
    const s = siteOf(r.apply_url);
    const fe = fam.get(f) ?? { tries: 0, sent: 0 };
    fe.tries++;
    if (ok) fe.sent++;
    fam.set(f, fe);
    if (s) {
      const se = site.get(s) ?? { tries: 0, sent: 0, family: f };
      se.tries++;
      if (ok) se.sent++;
      site.set(s, se);
    }
  }
  const byFamily = new Map<Family, RouteStats>();
  for (const [f, v] of fam) byFamily.set(f, { ...v, rate: (v.sent + 1) / (v.tries + 2) });
  const bySite = new Map<string, RouteStats>();
  for (const [s, v] of site) {
    const prior = byFamily.get(v.family)?.rate ?? 0.5;
    const k = 3; // weight of the family prior, in "tries"
    bySite.set(s, { tries: v.tries, sent: v.sent, rate: (v.sent + prior * k) / (v.tries + k) });
  }
  return { bySite, byFamily };
}

export interface RouteVerdict {
  /** Added to the queue priority (−20 … +12). */
  bonus: number;
  /** Don't spend time or AI on this route in this run. */
  skip: boolean;
  reason?: string;
}

/** How promising this application route is, from what the agent has learned. */
export function judgeRoute(learned: Learned, url: string | null | undefined): RouteVerdict {
  const s = learned.bySite.get(siteOf(url));
  const f = learned.byFamily.get(familyOf(url));
  const stats = s ?? f;
  if (!stats) return { bonus: 0, skip: false };
  // Keeps failing on this exact board: stop retrying it (the user gets it in Needs-you instead).
  if (s && s.tries >= 4 && s.sent === 0) return { bonus: -20, skip: true, reason: `${s.tries} tries on this site, none went through` };
  if (!s && f && f.tries >= 8 && f.sent === 0) return { bonus: -20, skip: true, reason: `${f.tries} tries on ${familyOf(url)} sites, none went through` };
  return { bonus: Math.round((stats.rate - 0.5) * 40), skip: false };
}

/** Lower-case title without punctuation, levels or seasons — to find the same job on another route. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\((?:[^)]*)\)/g, " ")
    .replace(/\b(summer|fall|winter|spring|20\d\d|remote|hybrid|onsite|us|usa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
