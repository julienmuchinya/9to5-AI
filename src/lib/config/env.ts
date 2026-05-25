export type EnvValidationIssue = {
  key: string;
  message: string;
  requiredFor: "all" | "live" | "gemini" | "gmail" | "encryption" | "agent";
};

function readEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_MOCK_MODE: process.env.NEXT_PUBLIC_MOCK_MODE,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    AGENT_SECRET: process.env.AGENT_SECRET ?? process.env.AGENT_CRON_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID,
    GOOGLE_CLIENT_SECRET:
      process.env.GOOGLE_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    MASTER_PASSWORD_HASH: process.env.MASTER_PASSWORD_HASH,
    AGENT_USER_ID: process.env.AGENT_USER_ID,
    MOCK_MODE: process.env.MOCK_MODE,
    LIVE_AGENT_ENABLED: process.env.LIVE_AGENT_ENABLED,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  };
}

export function isMockModeEnv(): boolean {
  return (
    process.env.NEXT_PUBLIC_MOCK_MODE === "true" ||
    process.env.MOCK_MODE === "true"
  );
}

export function validateBaseEnv(): EnvValidationIssue[] {
  const issues: EnvValidationIssue[] = [];
  const env = readEnv();

  if (!env.NEXT_PUBLIC_MOCK_MODE) {
    issues.push({
      key: "NEXT_PUBLIC_MOCK_MODE",
      message: "Set NEXT_PUBLIC_MOCK_MODE to true or false",
      requiredFor: "all",
    });
  }

  if (!env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === "production") {
    issues.push({
      key: "NEXT_PUBLIC_APP_URL",
      message: "Set NEXT_PUBLIC_APP_URL for production deployments",
      requiredFor: "all",
    });
  }

  if (!env.AGENT_SECRET) {
    issues.push({
      key: "AGENT_SECRET",
      message: "Set AGENT_SECRET (min 8 chars) for agent API routes",
      requiredFor: "all",
    });
  }

  return issues;
}

export function validateLiveSupabaseEnv(): EnvValidationIssue[] {
  if (isMockModeEnv()) return [];
  const env = readEnv();
  const issues: EnvValidationIssue[] = [];
  const keys = [
    ["NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY],
  ] as const;

  for (const [key, value] of keys) {
    if (!value) {
      issues.push({
        key,
        message: `${key} is required for live Supabase mode`,
        requiredFor: "live",
      });
    }
  }
  return issues;
}

export function validateGeminiEnv(aiEnabled: boolean): EnvValidationIssue[] {
  if (isMockModeEnv() || !aiEnabled) return [];
  if (!process.env.GEMINI_API_KEY) {
    return [
      {
        key: "GEMINI_API_KEY",
        message: "GEMINI_API_KEY required when Gemini is enabled in live mode",
        requiredFor: "gemini",
      },
    ];
  }
  return [];
}

export function validateGmailEnv(gmailEnabled: boolean): EnvValidationIssue[] {
  if (isMockModeEnv() || !gmailEnabled) return [];
  const env = readEnv();
  const issues: EnvValidationIssue[] = [];
  const clientId = env.GOOGLE_CLIENT_ID || env.GMAIL_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET || env.GMAIL_CLIENT_SECRET;

  if (!clientId) {
    issues.push({
      key: "GOOGLE_CLIENT_ID",
      message: "Google OAuth client ID required for Gmail scanning",
      requiredFor: "gmail",
    });
  }
  if (!clientSecret) {
    issues.push({
      key: "GOOGLE_CLIENT_SECRET",
      message: "Google OAuth client secret required (server only)",
      requiredFor: "gmail",
    });
  }
  if (!env.GOOGLE_REDIRECT_URI && !env.GMAIL_REFRESH_TOKEN) {
    issues.push({
      key: "GOOGLE_REDIRECT_URI",
      message: "OAuth redirect URI or refresh token required for Gmail",
      requiredFor: "gmail",
    });
  }
  return issues;
}

export function validateEncryptionEnv(enabled: boolean): EnvValidationIssue[] {
  if (!enabled) return [];
  const env = readEnv();
  const issues: EnvValidationIssue[] = [];
  if (!env.ENCRYPTION_KEY) {
    issues.push({
      key: "ENCRYPTION_KEY",
      message: "ENCRYPTION_KEY required when encrypted password storage is enabled",
      requiredFor: "encryption",
    });
  }
  if (!env.MASTER_PASSWORD_HASH) {
    issues.push({
      key: "MASTER_PASSWORD_HASH",
      message: "MASTER_PASSWORD_HASH required when encrypted password storage is enabled",
      requiredFor: "encryption",
    });
  }
  return issues;
}

export function validateAllEnv(options?: {
  aiEnabled?: boolean;
  gmailEnabled?: boolean;
  passwordStorageEnabled?: boolean;
}): EnvValidationIssue[] {
  return [
    ...validateBaseEnv(),
    ...validateLiveSupabaseEnv(),
    ...validateGeminiEnv(options?.aiEnabled ?? false),
    ...validateGmailEnv(options?.gmailEnabled ?? false),
    ...validateEncryptionEnv(options?.passwordStorageEnabled ?? false),
  ];
}

/** Safe public env snapshot — never includes server secrets */
export function getPublicEnvSnapshot(): Record<string, string | boolean> {
  return {
    mockMode: isMockModeEnv(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    supabaseConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    vercelEnv: process.env.VERCEL_ENV ?? "local",
  };
}

/** Keys that must never appear in client bundles or API responses */
export const SERVER_ONLY_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "AGENT_SECRET",
  "AGENT_CRON_SECRET",
  "GEMINI_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "ENCRYPTION_KEY",
  "MASTER_PASSWORD_HASH",
] as const;

export function stripServerSecrets<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const out = { ...obj };
  for (const key of SERVER_ONLY_KEYS) {
    delete out[key];
  }
  return out;
}
