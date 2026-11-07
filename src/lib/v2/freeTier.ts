import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Free-tier limits this app stays under. Each service is stopped at
 * SAFETY_RATIO of its limit so we never get near a bill. Override any value
 * with the matching env var if a provider changes its free tier.
 */
export const SAFETY_RATIO = 0.85;

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const FREE_LIMITS = {
  /** Gemini free tier: requests per day for the configured model. */
  geminiRequestsPerDay: num(process.env.FREE_GEMINI_RPD, 250),
  /** Gemini free tier: requests per minute. */
  geminiRequestsPerMinute: num(process.env.FREE_GEMINI_RPM, 10),
  /** Supabase free: 500 MB database. */
  supabaseDbBytes: num(process.env.FREE_SUPABASE_DB_MB, 500) * 1024 * 1024,
  /** Supabase free: 1 GB file storage. */
  supabaseStorageBytes: num(process.env.FREE_SUPABASE_STORAGE_MB, 1024) * 1024 * 1024,
  /** Supabase free: 50,000 monthly active users. */
  supabaseUsers: num(process.env.FREE_SUPABASE_MAU, 50000),
  /** GitHub Actions free minutes per month for private repos (public repos are unlimited). */
  githubActionsMinutes: num(process.env.FREE_GITHUB_MINUTES, 2000),
} as const;

export type Metric =
  | "gemini_requests"
  | "gemini_tokens"
  | "jobs_discovered"
  | "applications_submitted"
  | "github_actions_minutes"
  | "ai_groq_requests"
  | "ai_openrouter_requests";

export const today = () => new Date().toISOString().slice(0, 10);
export const thisMonth = () => new Date().toISOString().slice(0, 7);

export async function bumpUsage(
  db: SupabaseClient,
  metric: Metric,
  by = 1,
  scope = "global",
  period = metric === "github_actions_minutes" ? thisMonth() : today()
): Promise<number> {
  const { data, error } = await db.rpc("increment_usage", {
    p_scope: scope,
    p_metric: metric,
    p_period: period,
    p_by: by,
  });
  if (error) throw new Error(`usage counter failed: ${error.message}`);
  return Number(data ?? 0);
}

export async function readUsage(
  db: SupabaseClient,
  metric: Metric,
  scope = "global",
  period = metric === "github_actions_minutes" ? thisMonth() : today()
): Promise<number> {
  const { data } = await db
    .from("usage_counters")
    .select("value")
    .eq("scope", scope)
    .eq("metric", metric)
    .eq("period", period)
    .maybeSingle();
  return Number(data?.value ?? 0);
}

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number;
  stopAt: number;
  reason?: string;
}

export function check(used: number, limit: number, label: string): LimitCheck {
  const stopAt = Math.floor(limit * SAFETY_RATIO);
  const allowed = used < stopAt;
  return {
    allowed,
    used,
    limit,
    stopAt,
    reason: allowed ? undefined : `${label} at ${used}/${limit} — paused at ${Math.round(SAFETY_RATIO * 100)}% to stay free`,
  };
}

export async function checkGemini(db: SupabaseClient): Promise<LimitCheck> {
  const used = await readUsage(db, "gemini_requests");
  return check(used, FREE_LIMITS.geminiRequestsPerDay, "Gemini requests today");
}

export interface FreeTierSnapshot {
  gemini: LimitCheck;
  database: LimitCheck;
  storage: LimitCheck;
  users: LimitCheck;
  githubMinutes: LimitCheck & { unlimited: boolean };
  jobsDiscoveredToday: number;
  applicationsToday: number;
}

export async function freeTierSnapshot(db: SupabaseClient): Promise<FreeTierSnapshot> {
  const [gemini, sizesRes, minutes, jobs, apps] = await Promise.all([
    checkGemini(db),
    db.rpc("free_tier_sizes"),
    readUsage(db, "github_actions_minutes"),
    readUsage(db, "jobs_discovered"),
    readUsage(db, "applications_submitted"),
  ]);
  const sizes = (sizesRes.data ?? {}) as { db_bytes?: number; storage_bytes?: number; users?: number };
  const publicRepo = process.env.GITHUB_REPO_PUBLIC === "true";
  return {
    gemini,
    database: check(Number(sizes.db_bytes ?? 0), FREE_LIMITS.supabaseDbBytes, "Database size"),
    storage: check(Number(sizes.storage_bytes ?? 0), FREE_LIMITS.supabaseStorageBytes, "File storage"),
    users: check(Number(sizes.users ?? 0), FREE_LIMITS.supabaseUsers, "Accounts"),
    githubMinutes: {
      ...check(minutes, FREE_LIMITS.githubActionsMinutes, "GitHub Actions minutes this month"),
      ...(publicRepo ? { allowed: true, reason: undefined } : {}),
      unlimited: publicRepo,
    },
    jobsDiscoveredToday: jobs,
    applicationsToday: apps,
  };
}
