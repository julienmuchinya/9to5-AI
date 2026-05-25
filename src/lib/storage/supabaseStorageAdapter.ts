import { getDefaultStore, type LocalStore } from "@/lib/store/local-store";
import { createAdminClient, getAgentUserId } from "@/lib/supabase/admin";
import { isMockModeEnv } from "@/lib/config/env";
import type { AppStore, StorageAdapter } from "./storageAdapter";

type DbRow = Record<string, unknown>;

const REQUIRED_TABLES = [
  "profiles",
  "companies",
  "jobs",
  "applications",
  "resume_templates",
  "cover_letter_templates",
  "evidence_bank",
  "autopilot_settings",
  "agent_usage_limits",
  "agent_runs",
  "agent_logs",
  "blocked_actions",
  "ai_cache",
] as const;

export class SupabaseStorageAdapter implements StorageAdapter {
  readonly mode = "supabase" as const;

  isAvailable(): boolean {
    if (isMockModeEnv()) return false;
    return Boolean(createAdminClient() && getAgentUserId());
  }

  async load(): Promise<AppStore> {
    const client = createAdminClient();
    const userId = getAgentUserId();
    if (!client || !userId) return getDefaultStore();

    const def = getDefaultStore();

    const [
      profileRes,
      companiesRes,
      jobsRes,
      appsRes,
      resumesRes,
      clRes,
      evidenceRes,
      autopilotRes,
      limitsRes,
      runsRes,
      logsRes,
      blockedRes,
      cacheRes,
    ] = await Promise.all([
      client.from("profiles").select("*").eq("id", userId).maybeSingle(),
      client.from("companies").select("*").eq("user_id", userId),
      client.from("jobs").select("*").eq("user_id", userId),
      client.from("applications").select("*").eq("user_id", userId),
      client.from("resume_templates").select("*").eq("user_id", userId),
      client.from("cover_letter_templates").select("*").eq("user_id", userId),
      client.from("evidence_bank").select("*").eq("user_id", userId),
      client.from("autopilot_settings").select("*").eq("user_id", userId).maybeSingle(),
      client.from("agent_usage_limits").select("*").eq("user_id", userId).maybeSingle(),
      client.from("agent_runs").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(50),
      client.from("agent_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(500),
      client.from("blocked_actions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
      client.from("ai_cache").select("*").eq("user_id", userId).limit(200),
    ]);

    const profile = profileRes.data as Record<string, unknown> | null;
    const store: LocalStore = {
      ...def,
      profile: profile
        ? {
            ...def.profile,
            id: String(profile.id ?? userId),
            full_name: String(profile.full_name ?? def.profile.full_name),
            school: String(profile.school ?? def.profile.school),
            job_email: String(profile.job_email ?? def.profile.job_email),
            location_preference: String(
              profile.location_preference ?? def.profile.location_preference
            ),
            work_mode: String(profile.work_mode ?? def.profile.work_mode),
            relocation: Boolean(profile.relocation ?? def.profile.relocation),
            sponsorship_needed: Boolean(
              profile.sponsorship_needed ?? def.profile.sponsorship_needed
            ),
            target_roles: (profile.target_roles as string[]) ?? def.profile.target_roles,
            skills: (profile.skills as string[]) ?? def.profile.skills,
          }
        : def.profile,
      companies: ((companiesRes.data ?? []) as DbRow[]).map((c) => ({
        id: String(c.id),
        name: String(c.name),
        domain: (c.domain as string) ?? undefined,
        career_url: (c.career_url as string) ?? undefined,
        trust_score: Number(c.trust_score ?? 85),
        scan_enabled: Boolean(c.scan_enabled ?? true),
      })),
      jobs: ((jobsRes.data ?? []) as DbRow[]).map((j) => ({
        id: String(j.id),
        title: String(j.title),
        company_name: "",
        description: String(j.description ?? ""),
        url: (j.url as string) ?? undefined,
        status: String(j.status ?? "discovered"),
        fit_score: j.fit_score != null ? Number(j.fit_score) : undefined,
        trust_score: j.trust_score != null ? Number(j.trust_score) : undefined,
        source: String(j.source ?? "manual"),
        idempotency_key: String(j.idempotency_key),
      })),
      applications: ((appsRes.data ?? []) as DbRow[]).map((a) => ({
        id: String(a.id),
        job_id: String(a.job_id),
        status: String(a.status ?? "pending"),
        decision: (a.decision as string) ?? undefined,
        fit_score: a.fit_score != null ? Number(a.fit_score) : undefined,
        trust_score: a.trust_score != null ? Number(a.trust_score) : undefined,
        resume_match_score:
          a.resume_match_score != null ? Number(a.resume_match_score) : undefined,
        cover_letter_match_score:
          a.cover_letter_match_score != null
            ? Number(a.cover_letter_match_score)
            : undefined,
        decision_reason: (a.decision_reason as Record<string, string | boolean | undefined>) ?? {},
      })),
      resume_templates: ((resumesRes.data ?? []) as DbRow[]).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        slug: String(r.slug),
        content: String(r.content ?? ""),
        skills: (r.skills as string[]) ?? [],
        is_active: Boolean(r.is_active ?? false),
      })),
      cover_letter_templates: ((clRes.data ?? []) as DbRow[]).map((c) => ({
        id: String(c.id),
        name: String(c.name),
        slug: String(c.slug),
        content: String(c.content ?? ""),
        is_active: Boolean(c.is_active ?? true),
      })),
      evidence_bank: ((evidenceRes.data ?? []) as DbRow[]).map((e) => ({
        id: String(e.id),
        category: String(e.category),
        title: String(e.title),
        content: String(e.content),
        skills: (e.skills as string[]) ?? [],
        tools: (e.tools as string[]) ?? [],
        proof: (e.proof as string) ?? undefined,
        approved: Boolean(e.approved ?? false),
      })),
      autopilot_settings: autopilotRes.data
        ? {
            ...def.autopilot_settings,
            auto_apply_enabled: Boolean(
              (autopilotRes.data as DbRow).auto_apply_enabled ?? false
            ),
            mock_mode: Boolean((autopilotRes.data as DbRow).mock_mode ?? false),
            emergency_stop: Boolean(
              (autopilotRes.data as DbRow).emergency_stop ?? true
            ),
            password_storage_enabled: Boolean(
              (autopilotRes.data as DbRow).password_storage_enabled ?? false
            ),
            gmail_scanning_enabled: Boolean(
              (autopilotRes.data as DbRow).gmail_scanning_enabled ??
                def.autopilot_settings.gmail_scanning_enabled
            ),
            gemini_enabled: Boolean(
              (autopilotRes.data as DbRow).gemini_enabled ??
                def.autopilot_settings.gemini_enabled
            ),
            outreach_enabled: Boolean(
              (autopilotRes.data as DbRow).outreach_enabled ?? false
            ),
          }
        : def.autopilot_settings,
      agent_usage_limits: limitsRes.data
        ? {
            maxApplicationsPerDay: Number(
              (limitsRes.data as DbRow).max_applications_per_day ?? 50
            ),
            maxOutreachPerDay: Number((limitsRes.data as DbRow).max_outreach_per_day ?? 10),
            maxFollowupsPerDay: Number((limitsRes.data as DbRow).max_followups_per_day ?? 10),
            maxJobsAnalyzedPerDay: Number(
              (limitsRes.data as DbRow).max_jobs_analyzed_per_day ?? 90
            ),
            maxCompaniesScannedPerDay: Number(
              (limitsRes.data as DbRow).max_companies_scanned_per_day ?? 80
            ),
            maxAiCallsPerDay: Number((limitsRes.data as DbRow).max_ai_calls_per_day ?? 50),
            maxDbWritesPerDay: Number((limitsRes.data as DbRow).max_db_writes_per_day ?? 1000),
            maxDbReadsPerDay: Number((limitsRes.data as DbRow).max_db_reads_per_day ?? 5000),
            maxStorageMb: Number((limitsRes.data as DbRow).max_storage_mb ?? 400),
            maxCostPerDay: Number((limitsRes.data as DbRow).max_cost_per_day ?? 0),
            maxCostPerMonth: Number((limitsRes.data as DbRow).max_cost_per_month ?? 0),
            applications_today: Number((limitsRes.data as DbRow).applications_today ?? 0),
            outreach_today: Number((limitsRes.data as DbRow).outreach_today ?? 0),
            jobs_analyzed_today: Number((limitsRes.data as DbRow).jobs_analyzed_today ?? 0),
            ai_calls_today: Number((limitsRes.data as DbRow).ai_calls_today ?? 0),
            companies_scanned_today: 0,
            emails_scanned_today: 0,
            jobs_saved_today: 0,
            duplicates_skipped_today: 0,
            cache_hits_today: 0,
            db_writes_today: 0,
            db_reads_today: 0,
            estimated_cost_today: 0,
          }
        : def.agent_usage_limits,
      agent_runs: ((runsRes.data ?? []) as DbRow[]).map((r) => ({
        id: String(r.id),
        status: String(r.status),
        started_at: String(r.started_at),
        ended_at: (r.ended_at as string) ?? undefined,
        summary: (r.summary as Record<string, unknown>) ?? {},
        mock_mode: Boolean(r.mock_mode ?? false),
      })),
      agent_logs: ((logsRes.data ?? []) as DbRow[]).map((l) => ({
        id: String(l.id),
        run_id: String(l.run_id),
        level: String(l.level),
        message: String(l.message),
        metadata: (l.metadata as Record<string, unknown>) ?? {},
        created_at: String(l.created_at),
      })),
      blocked_actions: ((blockedRes.data ?? []) as DbRow[]).map((b) => ({
        id: String(b.id),
        reason_code: String(b.reason_code),
        reason_detail: (b.reason_detail as string) ?? undefined,
        suggested_action: (b.suggested_action as string) ?? undefined,
        resolved: Boolean(b.resolved ?? false),
        created_at: String(b.created_at),
      })),
      ai_cache: ((cacheRes.data ?? []) as DbRow[]).map((c) => ({
        id: String(c.id),
        jd_hash: String(c.jd_hash),
        fit_score: c.fit_score != null ? Number(c.fit_score) : undefined,
        output: (c.output as Record<string, unknown>) ?? {},
      })),
    };

    return store;
  }

  async save(store: AppStore): Promise<void> {
    const client = createAdminClient();
    const userId = getAgentUserId();
    if (!client || !userId) return;

    const upsert = (table: string, row: DbRow) =>
      client.from(table).upsert(row as never);

    await upsert("profiles", {
      id: userId,
      full_name: store.profile.full_name,
      school: store.profile.school,
      job_email: store.profile.job_email,
      skills: store.profile.skills,
      target_roles: store.profile.target_roles,
      location_preference: store.profile.location_preference,
      relocation: store.profile.relocation,
      sponsorship_needed: store.profile.sponsorship_needed,
    });

    await upsert("autopilot_settings", {
      user_id: userId,
      auto_apply_enabled: store.autopilot_settings.auto_apply_enabled,
      mock_mode: store.autopilot_settings.mock_mode,
      emergency_stop: store.autopilot_settings.emergency_stop,
      password_storage_enabled: store.autopilot_settings.password_storage_enabled,
    });

    const limits = store.agent_usage_limits;
    await upsert("agent_usage_limits", {
      user_id: userId,
      applications_today: limits.applications_today,
      outreach_today: limits.outreach_today,
      jobs_analyzed_today: limits.jobs_analyzed_today,
      ai_calls_today: limits.ai_calls_today,
      max_cost_per_day: limits.maxCostPerDay,
      max_cost_per_month: limits.maxCostPerMonth,
    });

    for (const run of store.agent_runs.slice(0, 5)) {
      await upsert("agent_runs", {
        id: run.id,
        user_id: userId,
        status: run.status,
        started_at: run.started_at,
        ended_at: run.ended_at,
        summary: run.summary,
        mock_mode: run.mock_mode,
      });
    }

    for (const log of store.agent_logs.slice(0, 100)) {
      await upsert("agent_logs", {
        id: log.id,
        user_id: userId,
        run_id: log.run_id,
        level: log.level,
        message: log.message,
        metadata: log.metadata,
        created_at: log.created_at,
      });
    }
  }
}

export async function checkSupabaseTablesExist(): Promise<{
  ok: boolean;
  missing: string[];
}> {
  const client = createAdminClient();
  if (!client) return { ok: false, missing: [...REQUIRED_TABLES] };

  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const { error } = await client.from(table).select("*").limit(1);
    if (error) missing.push(table);
  }
  return { ok: missing.length === 0, missing };
}
