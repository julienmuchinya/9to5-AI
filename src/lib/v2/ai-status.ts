import type { SupabaseClient } from "@supabase/supabase-js";
import { checkGemini, freeTierSnapshot, readUsage, SAFETY_RATIO } from "./freeTier";
import { fallbackStatus, type FallbackStatus } from "./fallback-ai";
import { minutesPlan } from "./minutes";

export interface AiStatusData {
  /** Which AI the agent is using right now. */
  mode: "gemini" | "backup" | "out";
  gemini: { used: number; stopAt: number; limit: number; resetsInH: number; resetAt: string };
  backups: FallbackStatus[];
  /** When our daily Groq/OpenRouter counters start over (midnight UTC). */
  backupResetAt: string;
  minutes: { usedMonth: number; limit: number; stopAt: number; usedToday: number; dayAllowance: number; unlimited: boolean; resetsInH: number; resetAt: string };
}

/** The next midnight in Los Angeles (Gemini's free quota resets then), as an exact instant. */
export function nextPacificMidnight(now = new Date()): Date {
  const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  const today = parts(now);
  // Midnight Pacific is 07:00 or 08:00 UTC (daylight saving or not): pick the one that is midnight there.
  for (const off of [7, 8]) {
    const cand = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + 1, off));
    const p = parts(cand);
    if (Number(p.hour) === 0 && cand > now) return cand;
  }
  return new Date(now.getTime() + 24 * 3600_000);
}

/** The next midnight UTC (our daily counters for the backup AI and run minutes start over). */
export const nextUtcMidnight = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

/** Hours until midnight Pacific (when Gemini's free quota resets). */
export function hoursToPacificMidnight(now = new Date()): number {
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const midnight = new Date(pt);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(0, Math.round(((midnight.getTime() - pt.getTime()) / 3600_000) * 10) / 10);
}

export async function aiStatus(db: SupabaseClient): Promise<AiStatusData> {
  const [g, backups, snap, usedToday] = await Promise.all([checkGemini(db), fallbackStatus(db), freeTierSnapshot(db), readUsage(db, "github_actions_minutes_day").catch(() => 0)]);
  const backupLeft = backups.some((b) => b.used < b.stopAt);
  const plan = minutesPlan({
    usedMonth: snap.githubMinutes.used,
    usedToday,
    limit: snap.githubMinutes.limit,
    ratio: SAFETY_RATIO,
    maxRunMin: 40,
    manual: false,
    publicRepo: snap.githubMinutes.unlimited,
  });
  return {
    mode: g.allowed ? "gemini" : backupLeft ? "backup" : "out",
    gemini: { used: g.used, stopAt: g.stopAt, limit: g.limit, resetsInH: hoursToPacificMidnight(), resetAt: nextPacificMidnight().toISOString() },
    backups,
    backupResetAt: nextUtcMidnight().toISOString(),
    minutes: {
      usedMonth: snap.githubMinutes.used,
      limit: snap.githubMinutes.limit,
      stopAt: Math.floor(snap.githubMinutes.limit * SAFETY_RATIO),
      usedToday,
      dayAllowance: plan.dayAllowance,
      unlimited: snap.githubMinutes.unlimited,
      // Today's share starts over at midnight UTC.
      resetsInH: Math.round(((nextUtcMidnight().getTime() - Date.now()) / 3600_000) * 10) / 10,
      resetAt: nextUtcMidnight().toISOString(),
    },
  };
}
