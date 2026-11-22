import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Free-tier limits this app stays under. Each service (Gemini, the backup AIs, GitHub minutes, Supabase)
 * is stopped at SAFETY_RATIO of its limit — 99%, so almost the whole free allowance gets used while the
 * last 1% stays as headroom for counting lag. Override with SAFETY_RATIO (e.g. 0.9) or the per-limit env vars
 * if a provider changes its free tier.
 */
const ratioEnv = Number(process.env.SAFETY_RATIO);
export const SAFETY_RATIO = ratioEnv > 0 && ratioEnv <= 1 ? ratioEnv : 0.99;

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const FREE_LIMITS = {
  /** Gemini free tier: requests per day, PER MODEL (each Flash model has its own daily quota). */
  geminiRequestsPerDay: num(process.env.FREE_GEMINI_RPD, 250),
  /** How many Gemini models the agent rotates through (gemini.ts MODEL_CHAIN): the day's total is RPD × this. */
  geminiModels: num(process.env.FREE_GEMINI_MODELS, 5),
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
  | "github_actions_minutes_day"
  | "digest_sent"
  | "ai_groq_requests"
  | "ai_openrouter_requests";

export const today = () => new Date().toISOString().slice(0, 10);
export const thisMonth = () => new Date().toISOString().slice(0, 7);
/** Gemini's free quota resets at midnight Pacific time, not UTC (UTC midnight is 4-5 pm there). */
export const pacificDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
/** The counter period a metric belongs to. */
export const periodFor = (metric: Metric) =>
  metric === "github_actions_minutes" ? thisMonth() : metric.startsWith("gemini_") ? pacificDay() : today();

export async function bumpUsage(
  db: SupabaseClient,
  metric: Metric,
  by = 1,
  scope = "global",
  period = periodFor(metric)
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
  period = periodFor(metric)
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
  // The total across every model; each model also stops at 99% of its own quota (gemini.ts).
  return check(used, FREE_LIMITS.geminiRequestsPerDay * FREE_LIMITS.geminiModels, "Gemini requests today");
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

let repoPublicCache: { value: boolean; at: number } | null = null;
/**
 * Is the agent's GitHub repo public (unlimited Actions minutes)? GITHUB_REPO_PUBLIC decides when set (the
 * workflow sets it); otherwise GitHub is asked once an hour. The dashboard on Vercel never had the variable, so it
 * treated a public repo as private — "2,000 minutes a month, today's share used up" — and said minutes ran out.
 * If GitHub can't be reached the answer is "public": a private repo without billing just stops at its limit, it
 * never charges.
 */
export async function repoIsPublic(): Promise<boolean> {
  const env = process.env.GITHUB_REPO_PUBLIC;
  if (env === "true" || env === "false") return env === "true";
  if (repoPublicCache && Date.now() - repoPublicCache.at < 3600_000) return repoPublicCache.value;
  const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "julienmuchinya/9to5-AI";
  const token = process.env.GH_DISPATCH_TOKEN ?? process.env.GITHUB_TOKEN;
  let value = true;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (res.ok) value = !(await res.json()).private;
    else if (res.status === 404 && !token) value = false; // private repos are invisible without a token
  } catch {
    // unreachable: keep "public"
  }
  repoPublicCache = { value, at: Date.now() };
  return value;
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
  const publicRepo = await repoIsPublic();
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
