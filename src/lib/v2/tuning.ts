import { COMPANY_DAILY_CAP, MAX_POSTING_AGE_DAYS } from "./priority";

/**
 * How the agent picks and orders jobs — set by each user on Settings (autopilot_settings.tuning, migration 010).
 * Missing or invalid values fall back to the defaults, so older databases keep working.
 */
export type Order = "fresh" | "balanced" | "fit";
export interface Tuning {
  /** Skip postings older than this many days. */
  max_age_days: number;
  /** At most this many applications to one company per day. */
  company_cap: number;
  /** Queue order: newest postings first, a mix, or best fit first. */
  order: Order;
  /** Roles from chat ("go apply to …") and the Focus field go before everything else. */
  focus_first: boolean;
  /** Jobs you queued yourself (Apply button, chat) go before the agent's own picks. */
  mine_first: boolean;
}

export const TUNING_LIMITS = { max_age_days: [3, 30], company_cap: [1, 30] } as const;
export const DEFAULT_TUNING: Tuning = { max_age_days: MAX_POSTING_AGE_DAYS, company_cap: COMPANY_DAILY_CAP, order: "balanced", focus_first: true, mine_first: true };

const clamp = (n: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
};

export function readTuning(raw: unknown): Tuning {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    max_age_days: clamp(t.max_age_days, TUNING_LIMITS.max_age_days, DEFAULT_TUNING.max_age_days),
    company_cap: clamp(t.company_cap, TUNING_LIMITS.company_cap, DEFAULT_TUNING.company_cap),
    order: t.order === "fresh" || t.order === "fit" || t.order === "balanced" ? t.order : DEFAULT_TUNING.order,
    focus_first: typeof t.focus_first === "boolean" ? t.focus_first : DEFAULT_TUNING.focus_first,
    mine_first: typeof t.mine_first === "boolean" ? t.mine_first : DEFAULT_TUNING.mine_first,
  };
}

/** How much the freshness bonus counts in the queue order. */
export const freshWeight = (o: Order) => (o === "fresh" ? 1.6 : o === "fit" ? 0.25 : 1);
