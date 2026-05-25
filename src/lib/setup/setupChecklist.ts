import type { RuntimeMode } from "@/lib/config/runtimeMode";
import type { SetupCheckItem } from "@/lib/types";

export interface SetupCheckContext {
  runtimeMode: RuntimeMode;
  mockModeEnv: boolean;
  supabaseUrl: boolean;
  supabaseAnonKey: boolean;
  supabaseServiceRole: boolean;
  databaseReachable: boolean;
  tablesExist: boolean;
  seedInstalled: boolean;
  rlsEnabled: boolean;
  profileExists: boolean;
  skillsExist: boolean;
  projectsExist: boolean;
  targetRolesExist: boolean;
  locationSet: boolean;
  sponsorshipAnswered: boolean;
  relocationAnswered: boolean;
  activeResumeCount: number;
  coverLetterCount: number;
  evidenceApprovedCount: number;
  geminiOrMock: boolean;
  geminiDisabledInSettings: boolean;
  costLimitZero: boolean;
  gmailConfigured: boolean;
  gmailOAuthConnected: boolean;
  jobEmailSet: boolean;
  outreachDisabled: boolean;
  emergencyStop: boolean;
  autopilotOff: boolean;
  limitsConfigured: boolean;
  spamGuardEnabled: boolean;
  scamGuardEnabled: boolean;
  duplicateProtectionEnabled: boolean;
  blockedLoggingEnabled: boolean;
  githubWorkflowExists: boolean;
  liveAgentSecretSet: boolean;
  liveAgentEnabled: boolean;
  companyCount: number;
  lastAgentRunOk: boolean;
}

/** Legacy context from Phase 1 */
export interface LegacySetupCheckContext {
  supabaseConfigured: boolean;
  schemaInstalled: boolean;
  geminiOrMock: boolean;
  gmailConnected: boolean;
  jobEmailSet: boolean;
  profileComplete: boolean;
  companyCount: number;
  activeResumeCount: number;
  coverLetterCount: number;
  evidenceCount: number;
  limitsConfigured: boolean;
  lastAgentRunOk: boolean;
  emergencyStopVisible: boolean;
}

export function legacyToContext(legacy: LegacySetupCheckContext): SetupCheckContext {
  return {
    runtimeMode: legacy.supabaseConfigured ? "LIVE_LOCAL" : "MOCK_LOCAL",
    mockModeEnv: !legacy.supabaseConfigured,
    supabaseUrl: legacy.supabaseConfigured,
    supabaseAnonKey: legacy.supabaseConfigured,
    supabaseServiceRole: legacy.schemaInstalled,
    databaseReachable: legacy.schemaInstalled,
    tablesExist: legacy.schemaInstalled,
    seedInstalled: legacy.schemaInstalled,
    rlsEnabled: true,
    profileExists: legacy.profileComplete,
    skillsExist: legacy.profileComplete,
    projectsExist: legacy.profileComplete,
    targetRolesExist: legacy.profileComplete,
    locationSet: legacy.profileComplete,
    sponsorshipAnswered: true,
    relocationAnswered: true,
    activeResumeCount: legacy.activeResumeCount,
    coverLetterCount: legacy.coverLetterCount,
    evidenceApprovedCount: legacy.evidenceCount,
    geminiOrMock: legacy.geminiOrMock,
    geminiDisabledInSettings: false,
    costLimitZero: true,
    gmailConfigured: legacy.gmailConnected,
    gmailOAuthConnected: legacy.gmailConnected,
    jobEmailSet: legacy.jobEmailSet,
    outreachDisabled: true,
    emergencyStop: false,
    autopilotOff: true,
    limitsConfigured: legacy.limitsConfigured,
    spamGuardEnabled: true,
    scamGuardEnabled: true,
    duplicateProtectionEnabled: true,
    blockedLoggingEnabled: true,
    githubWorkflowExists: legacy.lastAgentRunOk,
    liveAgentSecretSet: true,
    liveAgentEnabled: false,
    companyCount: legacy.companyCount,
    lastAgentRunOk: legacy.lastAgentRunOk,
  };
}

const MOCK_OPTIONAL_IDS = new Set([
  "runtime_mock",
  "supabase_url",
  "supabase_anon",
  "supabase_service_role",
  "db_reachable",
  "tables_exist",
  "seed_installed",
  "rls_enabled",
  "gmail_oauth",
  "gmail_configured",
  "github_workflow",
  "live_agent_enabled",
]);

export function evaluateSetupChecklist(
  ctx: SetupCheckContext | LegacySetupCheckContext
): SetupCheckItem[] {
  const c =
    "runtimeMode" in ctx ? ctx : legacyToContext(ctx as LegacySetupCheckContext);

  return [
    {
      id: "runtime_mock",
      label: "Runtime mode configured",
      complete: c.mockModeEnv || c.runtimeMode !== "MOCK_LOCAL",
      fixSteps: "Set NEXT_PUBLIC_MOCK_MODE=true for demo or false for live",
      href: "/settings",
    },
    {
      id: "supabase_url",
      label: "Supabase URL configured",
      complete: c.supabaseUrl,
      fixSteps: "Add NEXT_PUBLIC_SUPABASE_URL to .env.local",
      href: "/setup",
    },
    {
      id: "supabase_anon",
      label: "Supabase anon key configured",
      complete: c.supabaseAnonKey,
      fixSteps: "Add NEXT_PUBLIC_SUPABASE_ANON_KEY (frontend safe)",
      href: "/setup",
    },
    {
      id: "supabase_service_role",
      label: "Supabase service role (server only)",
      complete: c.supabaseServiceRole,
      fixSteps: "Add SUPABASE_SERVICE_ROLE_KEY — never expose to browser",
      href: "/setup",
    },
    {
      id: "db_reachable",
      label: "Database reachable",
      complete: c.databaseReachable,
      fixSteps: "Run migrations and verify connection in Setup",
      href: "/setup",
    },
    {
      id: "tables_exist",
      label: "Required tables exist",
      complete: c.tablesExist,
      fixSteps: "Run supabase/migrations/001_initial_schema.sql",
      href: "/setup",
    },
    {
      id: "seed_installed",
      label: "Seed data installed",
      complete: c.seedInstalled,
      fixSteps: "Run files in supabase/seed/",
      href: "/setup",
    },
    {
      id: "profile",
      label: "Profile completed",
      complete: c.profileExists && c.skillsExist && c.targetRolesExist,
      fixSteps: "Fill name, skills, target roles, location",
      href: "/profile",
    },
    {
      id: "companies",
      label: "Company watchlist (≥1)",
      complete: c.companyCount >= 1,
      fixSteps: "Add at least one company",
      href: "/companies",
    },
    {
      id: "companies_scan_ready",
      label: "Company scan readiness (≥5 companies, career URLs)",
      complete: c.mockModeEnv || c.companyCount >= 5,
      fixSteps: "Add at least 5 companies with career page URLs on Companies page",
      href: "/companies",
    },
    {
      id: "gmail_scan_ready",
      label: "Gmail scan readiness (credentials + job email + filters)",
      complete:
        c.mockModeEnv ||
        (c.gmailConfigured && c.gmailOAuthConnected && c.jobEmailSet),
      fixSteps: "Connect Gmail OAuth, set job-search email, configure alert filters in Settings",
      href: "/settings",
    },
    {
      id: "email_scan_enabled",
      label: "Email scanning configured",
      complete: c.mockModeEnv || c.gmailConfigured,
      fixSteps: "Enable email scanning in Settings after Gmail setup",
      href: "/settings",
    },
    {
      id: "resumes",
      label: "Resume library (≥5 active)",
      complete: c.activeResumeCount >= 5,
      fixSteps: "Activate at least 5 resume templates linked to evidence",
      href: "/resumes",
    },
    {
      id: "cover_letters",
      label: "Cover letter library (≥5)",
      complete: c.coverLetterCount >= 5,
      fixSteps: "Add at least 5 cover letter templates",
      href: "/cover-letters",
    },
    {
      id: "evidence",
      label: "Evidence Bank (≥10 approved)",
      complete: c.evidenceApprovedCount >= 10,
      fixSteps: "Approve at least 10 evidence items with proof",
      href: "/evidence",
    },
    {
      id: "gemini",
      label: "Gemini API or mock mode",
      complete: c.geminiOrMock || c.mockModeEnv,
      fixSteps: "Add GEMINI_API_KEY or keep mock mode on",
      href: "/settings",
    },
    {
      id: "cost_limit",
      label: "AI cost limit $0",
      complete: c.costLimitZero,
      fixSteps: "Keep maxCostPerDay at 0 on Limits page",
      href: "/limits",
    },
    {
      id: "gmail_configured",
      label: "Gmail credentials (if scanning enabled)",
      complete: c.mockModeEnv || c.gmailConfigured,
      fixSteps: "See docs/GOOGLE_GMAIL_OAUTH_SETUP.md",
      href: "/settings",
    },
    {
      id: "gmail_oauth",
      label: "Gmail OAuth connected",
      complete: c.mockModeEnv || c.gmailOAuthConnected,
      fixSteps: "Connect dedicated job-search Gmail",
      href: "/settings",
    },
    {
      id: "job_email",
      label: "Job-search email set",
      complete: c.jobEmailSet,
      fixSteps: "Add job alert email in Profile",
      href: "/profile",
    },
    {
      id: "outreach_disabled",
      label: "Outreach disabled until enabled",
      complete: c.outreachDisabled,
      fixSteps: "Keep outreach off until Part 3+",
      href: "/settings",
    },
    {
      id: "emergency_stop",
      label: "Emergency stop available",
      complete: true,
      fixSteps: "Toggle on Dashboard",
      href: "/dashboard",
    },
    {
      id: "autopilot_off",
      label: "Autopilot off by default",
      complete: c.autopilotOff,
      fixSteps: "Keep auto-apply off until setup complete",
      href: "/settings",
    },
    {
      id: "limits",
      label: "Daily limits configured",
      complete: c.limitsConfigured,
      fixSteps: "Review Limits page",
      href: "/limits",
    },
    {
      id: "github_workflow",
      label: "GitHub Actions workflow ready",
      complete: c.githubWorkflowExists,
      fixSteps: "See docs/GITHUB_ACTIONS_SETUP.md",
      href: "/agent-logs",
    },
    {
      id: "live_agent_enabled",
      label: "Live agent explicitly enabled (CI)",
      complete: c.mockModeEnv || !c.liveAgentEnabled || c.liveAgentSecretSet,
      fixSteps: "Set LIVE_AGENT_ENABLED=true only when ready",
      href: "/setup",
    },
  ];
}

export function isSetupComplete(
  items: SetupCheckItem[],
  options?: { mockMode?: boolean }
): boolean {
  const list = options?.mockMode
    ? items.filter((i) => !MOCK_OPTIONAL_IDS.has(i.id))
    : items;
  return list.every((i) => i.complete);
}

export function canRunAutopilot(
  items: SetupCheckItem[],
  emergencyStop: boolean,
  options?: { mockMode?: boolean }
): boolean {
  return isSetupComplete(items, options) && !emergencyStop;
}

export function canRunFullAutoApply(
  items: SetupCheckItem[],
  emergencyStop: boolean,
  autoApplyEnabled: boolean,
  options?: { mockMode?: boolean }
): boolean {
  return (
    canRunAutopilot(items, emergencyStop, options) && autoApplyEnabled
  );
}
