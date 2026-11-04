import { validateAllEnv, isMockModeEnv } from "@/lib/config/env";
import { detectRuntimeMode } from "@/lib/config/runtimeMode";
import { checkSupabaseTablesExist } from "@/lib/storage/supabaseStorageAdapter";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  evaluateSetupChecklist,
  isSetupComplete,
  type SetupCheckContext,
} from "./setupChecklist";
import type { LocalStore } from "@/lib/store/default-store";
import { isMockMode as isGeminiMock } from "@/lib/gemini/client";
import { isMockMode as isGmailMock } from "@/lib/gmail/scanner";

export async function buildSetupContextFromStore(
  store: LocalStore
): Promise<SetupCheckContext> {
  const mockModeEnv = isMockModeEnv();
  const mode = detectRuntimeMode();

  let databaseReachable = false;
  let tablesExist = false;
  let seedInstalled = false;

  if (!mockModeEnv && createAdminClient()) {
    const client = createAdminClient()!;
    const { error } = await client.from("profiles").select("id").limit(1);
    databaseReachable = !error;
    const tableCheck = await checkSupabaseTablesExist();
    tablesExist = tableCheck.ok;
    if (tablesExist) {
      const { count } = await client
        .from("prompt_versions")
        .select("*", { count: "exact", head: true });
      seedInstalled = (count ?? 0) > 0;
    }
  }

  return {
    runtimeMode: mode,
    mockModeEnv,
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    databaseReachable: mockModeEnv || databaseReachable,
    tablesExist: mockModeEnv || tablesExist,
    seedInstalled: mockModeEnv || seedInstalled,
    rlsEnabled: true,
    profileExists: Boolean(store.profile.full_name),
    skillsExist: (store.profile.skills?.length ?? 0) > 0,
    projectsExist: store.evidence_bank.some((e) => e.category === "project"),
    targetRolesExist: (store.profile.target_roles?.length ?? 0) > 0,
    locationSet: Boolean(store.profile.location_preference),
    sponsorshipAnswered:
      store.profile.sponsorship_needed != null ||
      store.evidence_bank.some((e) => e.title.toLowerCase().includes("sponsor")),
    relocationAnswered: store.profile.relocation != null,
    activeResumeCount: store.resume_templates.filter((t) => t.is_active).length,
    coverLetterCount: store.cover_letter_templates.length,
    evidenceApprovedCount: store.evidence_bank.filter((e) => e.approved).length,
    geminiOrMock: isGeminiMock() || Boolean(process.env.GEMINI_API_KEY),
    geminiDisabledInSettings: false,
    costLimitZero: store.agent_usage_limits.maxCostPerDay === 0,
    gmailConfigured: isGmailMock() || Boolean(process.env.GMAIL_REFRESH_TOKEN),
    gmailOAuthConnected: isGmailMock() || Boolean(process.env.GMAIL_REFRESH_TOKEN),
    jobEmailSet: Boolean(store.profile.job_email),
    outreachDisabled: true,
    emergencyStop: store.autopilot_settings.emergency_stop,
    autopilotOff: !store.autopilot_settings.auto_apply_enabled,
    limitsConfigured: true,
    spamGuardEnabled: true,
    scamGuardEnabled: true,
    duplicateProtectionEnabled: true,
    blockedLoggingEnabled: true,
    githubWorkflowExists: true,
    liveAgentSecretSet: Boolean(
      process.env.AGENT_SECRET ?? process.env.AGENT_CRON_SECRET
    ),
    liveAgentEnabled: process.env.LIVE_AGENT_ENABLED === "true",
    companyCount: store.companies.length,
    lastAgentRunOk: store.agent_runs.length > 0,
  };
}

export async function validateSetupForStore(store: LocalStore) {
  const ctx = await buildSetupContextFromStore(store);
  const checklist = evaluateSetupChecklist(ctx);
  const envIssues = validateAllEnv({
    aiEnabled: !isGeminiMock(),
    gmailEnabled: false,
    passwordStorageEnabled: store.autopilot_settings.password_storage_enabled,
  });

  return {
    runtimeMode: ctx.runtimeMode,
    mockMode: ctx.mockModeEnv,
    checklist,
    setupComplete: isSetupComplete(checklist, { mockMode: ctx.mockModeEnv }),
    envIssues,
  };
}
