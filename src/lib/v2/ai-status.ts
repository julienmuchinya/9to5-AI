import type { SupabaseClient } from "@supabase/supabase-js";
import { checkGemini, freeTierSnapshot, readUsage, SAFETY_RATIO } from "./freeTier";
import { fallbackStatus, type FallbackStatus } from "./fallback-ai";
import { minutesPlan } from "./minutes";

export interface AiStatusData {
  /** Which AI the agent is using right now. */
  mode: "gemini" | "backup" | "out";
  gemini: { used: number; stopAt: number; limit: number; resetsInH: number };
  backups: FallbackStatus[];
  minutes: { usedMonth: number; limit: number; stopAt: number; usedToday: number; dayAllowance: number; unlimited: boolean };
}

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
    gemini: { used: g.used, stopAt: g.stopAt, limit: g.limit, resetsInH: hoursToPacificMidnight() },
    backups,
    minutes: {
      usedMonth: snap.githubMinutes.used,
      limit: snap.githubMinutes.limit,
      stopAt: Math.floor(snap.githubMinutes.limit * SAFETY_RATIO),
      usedToday,
      dayAllowance: plan.dayAllowance,
      unlimited: snap.githubMinutes.unlimited,
    },
  };
}
