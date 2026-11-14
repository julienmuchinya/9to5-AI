/**
 * Which jobs to apply to first.
 * Fresh postings get far more replies, so priority = fit score + a freshness bonus,
 * and no company gets more than COMPANY_DAILY_CAP applications per day.
 */

export const COMPANY_DAILY_CAP = 15;
/** Overall per-user daily ceiling; the real brake is the free AI quota (budget guard). */
/** Highest daily cap the settings allow. The practical ceiling is AI budget and GitHub minutes, not this. */
export const MAX_DAILY_APPLY_CAP = 500;
/** New accounts (and the settings form) start here: apply to every good match, not a handful. */
export const DEFAULT_DAILY_CAP = 100;
export const DEFAULT_MIN_FIT = 55;

export interface FreshnessBucket {
  key: "today" | "2d" | "3d" | "week" | "2weeks" | "older" | "unknown";
  label: string;
  bonus: number;
}

const HOUR = 3600_000;

/** How fresh a posting is, as a label and a score bonus. */
export function freshness(postedAt: string | null | undefined, now = Date.now()): FreshnessBucket {
  const t = postedAt ? Date.parse(postedAt) : NaN;
  if (!Number.isFinite(t)) return { key: "unknown", label: "Date unknown", bonus: 5 };
  const h = Math.max(0, (now - t) / HOUR);
  // Replies drop fast after the first days, so freshness outweighs a few points of fit.
  if (h <= 12) return { key: "today", label: "Posted in the last 12h", bonus: 55 };
  if (h <= 24) return { key: "today", label: "Posted in the last 24h", bonus: 45 };
  if (h <= 48) return { key: "2d", label: "Posted 2 days ago", bonus: 32 };
  if (h <= 72) return { key: "3d", label: "Posted 3 days ago", bonus: 22 };
  if (h <= 7 * 24) return { key: "week", label: "Posted this week", bonus: 10 };
  if (h <= 14 * 24) return { key: "2weeks", label: "Posted 2 weeks ago", bonus: 0 };
  return { key: "older", label: "Posted over 2 weeks ago", bonus: -25 };
}

/** Short "3h ago" / "2d ago" text. */
export function ago(iso: string | null | undefined, now = Date.now()): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.round(d / 30)}mo ago`;
}

export function priorityScore(fit: number, postedAt: string | null | undefined, now = Date.now()): number {
  return Math.round(fit + freshness(postedAt, now).bonus);
}

/** Postings older than this are skipped by the agent (not worth the time or AI). Override with MAX_POSTING_AGE_DAYS. */
export const MAX_POSTING_AGE_DAYS = Number(process.env.MAX_POSTING_AGE_DAYS ?? 14);

/** Days since posting, or null when unknown. */
export function ageDays(postedAt: string | null | undefined, now = Date.now()): number | null {
  const t = postedAt ? Date.parse(postedAt) : NaN;
  return Number.isFinite(t) ? Math.max(0, (now - t) / (24 * HOUR)) : null;
}

/** Too old to bother with? Unknown dates are kept (they get a small score instead). */
export function tooOld(postedAt: string | null | undefined, maxDays = MAX_POSTING_AGE_DAYS, now = Date.now()): boolean {
  const d = ageDays(postedAt, now);
  return d != null && d > maxDays;
}

export const companyKey = (name: string | null | undefined) =>
  (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ (inc|llc|ltd|corp|corporation|co|company)$/, "")
    .trim();

export interface Candidate {
  company: string;
  fit: number;
  postedAt?: string | null;
  /** Asked for by the user (chat / Apply button) — goes before agent picks of equal priority. */
  userRequested?: boolean;
  /** Learned route bonus (how often this site/ATS goes through), see learning.ts. */
  routeBonus?: number;
  /** Matches a role the user asked for most recently (chat "focus") — goes before everything else. */
  focus?: boolean;
}

/** Priority added for the role the user just asked for: more than any freshness or fit difference. */
export const FOCUS_BONUS = 100;

/**
 * Orders candidates by priority and drops the ones over the per-company daily cap.
 * `appliedToday` = submissions already made today per companyKey.
 */
export function planQueue<T extends Candidate>(
  items: T[],
  opts: {
    appliedToday?: Record<string, number>;
    perCompany?: number;
    now?: number;
    /** Weight of the freshness bonus (Settings → order: newest first 1.6, balanced 1, best fit first 0.25). */
    freshWeight?: number;
    /** Focus roles before everything (default on). */
    focusFirst?: boolean;
    /** Jobs the user queued themselves before the agent's picks (default on; off = a small nudge only). */
    mineFirst?: boolean;
  } = {}
): { picked: T[]; skippedForCompanyCap: T[] } {
  const per = opts.perCompany ?? COMPANY_DAILY_CAP;
  const now = opts.now ?? Date.now();
  const fw = opts.freshWeight ?? 1;
  const mine = opts.mineFirst === false ? 15 : opts.mineFirst ? 60 : 15;
  const focus = opts.focusFirst === false ? 10 : FOCUS_BONUS;
  const used: Record<string, number> = { ...(opts.appliedToday ?? {}) };
  const sorted = items
    .map((x, i) => ({ x, i, s: x.fit + freshness(x.postedAt, now).bonus * fw + (x.userRequested ? mine : 0) + (x.routeBonus ?? 0) + (x.focus ? focus : 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((o) => o.x);
  const picked: T[] = [];
  const skippedForCompanyCap: T[] = [];
  for (const x of sorted) {
    const k = companyKey(x.company);
    if ((used[k] ?? 0) >= per) {
      skippedForCompanyCap.push(x);
      continue;
    }
    used[k] = (used[k] ?? 0) + 1;
    picked.push(x);
  }
  return { picked, skippedForCompanyCap };
}
