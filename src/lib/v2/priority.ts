/**
 * Which jobs to apply to first.
 * Fresh postings get far more replies, so priority = fit score + a freshness bonus,
 * and no company gets more than COMPANY_DAILY_CAP applications per day.
 */

export const COMPANY_DAILY_CAP = 5;
/** Overall per-user daily ceiling; the real brake is the free AI quota (budget guard). */
export const MAX_DAILY_APPLY_CAP = 100;

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
  if (h <= 24) return { key: "today", label: "Posted in the last 24h", bonus: 35 };
  if (h <= 48) return { key: "2d", label: "Posted 2 days ago", bonus: 25 };
  if (h <= 72) return { key: "3d", label: "Posted 3 days ago", bonus: 17 };
  if (h <= 7 * 24) return { key: "week", label: "Posted this week", bonus: 9 };
  if (h <= 14 * 24) return { key: "2weeks", label: "Posted 2 weeks ago", bonus: 3 };
  return { key: "older", label: "Posted over 2 weeks ago", bonus: -10 };
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
}

/**
 * Orders candidates by priority and drops the ones over the per-company daily cap.
 * `appliedToday` = submissions already made today per companyKey.
 */
export function planQueue<T extends Candidate>(
  items: T[],
  opts: { appliedToday?: Record<string, number>; perCompany?: number; now?: number } = {}
): { picked: T[]; skippedForCompanyCap: T[] } {
  const per = opts.perCompany ?? COMPANY_DAILY_CAP;
  const now = opts.now ?? Date.now();
  const used: Record<string, number> = { ...(opts.appliedToday ?? {}) };
  const sorted = items
    .map((x, i) => ({ x, i, s: priorityScore(x.fit, x.postedAt, now) + (x.userRequested ? 15 : 0) }))
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
