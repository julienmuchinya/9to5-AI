import { isMockModeEnv, validateAllEnv } from "@/lib/config/env";
import { detectRuntimeMode } from "@/lib/config/runtimeMode";
import { isSetupComplete, type SetupCheckContext } from "@/lib/setup/setupChecklist";
import { evaluateSetupChecklist } from "@/lib/setup/setupChecklist";
import type { LocalStore } from "@/lib/store/default-store";
import { DEFAULT_USAGE_LIMITS } from "@/lib/constants";

export interface LiveRunBlockReason {
  code: string;
  message: string;
  humanAction?: string;
}

export interface LiveRunGuardInput {
  store: LocalStore;
  agentSecretHeader?: string | null;
  setupContext?: Partial<SetupCheckContext>;
}

export function evaluateLiveRunGuard(input: LiveRunGuardInput): {
  allowed: boolean;
  reasons: LiveRunBlockReason[];
  mockMode: boolean;
} {
  const mockMode = isMockModeEnv() || input.store.autopilot_settings.mock_mode;

  if (mockMode) {
    return { allowed: true, reasons: [], mockMode: true };
  }

  const reasons: LiveRunBlockReason[] = [];
  const mode = detectRuntimeMode();

  const envIssues = validateAllEnv({
    aiEnabled: !input.store.autopilot_settings.mock_mode,
    gmailEnabled: false,
    passwordStorageEnabled: input.store.autopilot_settings.password_storage_enabled,
  });

  for (const issue of envIssues) {
    reasons.push({
      code: `ENV_${issue.key}`,
      message: issue.message,
      humanAction: `Add ${issue.key} to .env.local or GitHub secrets`,
    });
  }

  const expectedSecret = process.env.AGENT_SECRET ?? process.env.AGENT_CRON_SECRET;
  if (expectedSecret && input.agentSecretHeader !== expectedSecret) {
    reasons.push({
      code: "AGENT_SECRET_INVALID",
      message: "Invalid or missing AGENT_SECRET",
      humanAction: "Pass Authorization header with AGENT_SECRET for live runs",
    });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    reasons.push({
      code: "SUPABASE_MISSING",
      message: "Supabase is not configured for live mode",
      humanAction: "Complete Supabase setup in docs/SUPABASE_SETUP.md",
    });
  }

  const ctx: SetupCheckContext = {
    runtimeMode: mode,
    mockModeEnv: false,
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    databaseReachable: input.setupContext?.databaseReachable ?? false,
    tablesExist: input.setupContext?.tablesExist ?? false,
    seedInstalled: input.setupContext?.seedInstalled ?? false,
    rlsEnabled: input.setupContext?.rlsEnabled ?? true,
    profileExists: Boolean(input.store.profile.full_name),
    skillsExist: (input.store.profile.skills?.length ?? 0) > 0,
    projectsExist: true,
    targetRolesExist: (input.store.profile.target_roles?.length ?? 0) > 0,
    locationSet: Boolean(input.store.profile.location_preference),
    sponsorshipAnswered: true,
    relocationAnswered: input.store.profile.relocation != null,
    activeResumeCount: input.store.resume_templates.filter((t) => t.is_active).length,
    coverLetterCount: input.store.cover_letter_templates.length,
    evidenceApprovedCount: input.store.evidence_bank.filter((e) => e.approved).length,
    geminiOrMock: Boolean(process.env.GEMINI_API_KEY) || false,
    geminiDisabledInSettings: false,
    costLimitZero: DEFAULT_USAGE_LIMITS.maxCostPerDay === 0,
    gmailConfigured: false,
    gmailOAuthConnected: false,
    jobEmailSet: Boolean(input.store.profile.job_email),
    outreachDisabled: true,
    emergencyStop: input.store.autopilot_settings.emergency_stop,
    autopilotOff: !input.store.autopilot_settings.auto_apply_enabled,
    limitsConfigured: true,
    spamGuardEnabled: true,
    scamGuardEnabled: true,
    duplicateProtectionEnabled: true,
    blockedLoggingEnabled: true,
    githubWorkflowExists: true,
    liveAgentSecretSet: Boolean(expectedSecret),
    liveAgentEnabled: process.env.LIVE_AGENT_ENABLED === "true",
    companyCount: input.store.companies.length,
    lastAgentRunOk: input.store.agent_runs.length > 0,
    ...input.setupContext,
  };

  const checklist = evaluateSetupChecklist(ctx);
  if (!isSetupComplete(checklist, { mockMode: false })) {
    for (const item of checklist.filter((i) => !i.complete)) {
      reasons.push({
        code: `SETUP_${item.id}`,
        message: item.label,
        humanAction: item.fixSteps,
      });
    }
  }

  if (input.store.autopilot_settings.emergency_stop) {
    reasons.push({
      code: "EMERGENCY_STOP",
      message: "Emergency stop is enabled",
      humanAction: "Turn off emergency stop on Dashboard when ready",
    });
  }

  const costLimit = input.store.agent_usage_limits.maxCostPerDay ?? DEFAULT_USAGE_LIMITS.maxCostPerDay;
  if (costLimit > 0) {
    reasons.push({
      code: "COST_LIMIT",
      message: "Cost limit must remain $0 for Part 2 safety",
      humanAction: "Set maxCostPerDay to 0 on Limits page",
    });
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    mockMode: false,
  };
}
