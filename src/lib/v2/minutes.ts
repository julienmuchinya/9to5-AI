/**
 * GitHub Actions minutes planner. A private repo gets 2,000 free minutes a month and a full agent run
 * takes ~45, so eight scheduled runs a day would use the month up in about five days. This spreads what's
 * left (up to the 85% stop) evenly over the days left in the month:
 *  - scheduled runs use today's share, and skip once it's gone (the next day gets a fresh share);
 *  - a run you start yourself always goes ahead (at least 15 minutes) unless the monthly stop is reached.
 * Public repos have unlimited minutes, so nothing is rationed there.
 */
export interface MinutesPlan {
  /** Minutes this run may spend applying (0 = don't apply). */
  budgetMin: number;
  /** Skip the whole run (nothing useful fits). */
  skip: boolean;
  /** Today's fair share of the month's remaining minutes. */
  dayAllowance: number;
  /** Minutes left of today's share. */
  todayLeft: number;
  reason: string;
}

/** Boot, browser install and job discovery take a few minutes before applying starts. */
export const RUN_OVERHEAD_MIN = 4;

export function minutesPlan(o: {
  usedMonth: number;
  usedToday: number;
  limit: number;
  ratio: number;
  maxRunMin: number;
  manual: boolean;
  publicRepo: boolean;
  now?: Date;
}): MinutesPlan {
  const now = o.now ?? new Date();
  if (o.publicRepo) return { budgetMin: o.maxRunMin, skip: false, dayAllowance: Infinity, todayLeft: Infinity, reason: "public repo: unlimited minutes" };
  const stopAt = Math.floor(o.limit * o.ratio);
  const monthLeft = stopAt - o.usedMonth;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - now.getUTCDate() + 1;
  const dayAllowance = Math.max(0, Math.floor((stopAt - (o.usedMonth - o.usedToday)) / daysLeft));
  const todayLeft = dayAllowance - o.usedToday;
  if (monthLeft <= RUN_OVERHEAD_MIN + 2)
    return { budgetMin: 0, skip: true, dayAllowance, todayLeft, reason: `GitHub minutes this month at ${o.usedMonth}/${o.limit} — paused at ${Math.round(o.ratio * 100)}% to stay free` };
  const fair = Math.min(o.maxRunMin, todayLeft - RUN_OVERHEAD_MIN);
  if (o.manual) {
    const budget = Math.max(0, Math.min(o.maxRunMin, Math.max(fair, 15), monthLeft - RUN_OVERHEAD_MIN));
    return { budgetMin: budget, skip: budget <= 0, dayAllowance, todayLeft, reason: `manual run: ${budget} min (today's share ${Math.max(0, todayLeft)}/${dayAllowance} min left)` };
  }
  if (fair < 6) return { budgetMin: 0, skip: true, dayAllowance, todayLeft, reason: `today's GitHub minutes share is used (${o.usedToday}/${dayAllowance} min) — the next scheduled run tomorrow gets a fresh share; Run now still works` };
  return { budgetMin: fair, skip: false, dayAllowance, todayLeft, reason: `${fair} min of today's ${dayAllowance}-minute share` };
}
