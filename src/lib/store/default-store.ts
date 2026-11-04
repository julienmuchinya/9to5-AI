import {
  MOCK_COMPANIES,
  MOCK_EVIDENCE,
  MOCK_PROFILE,
  MOCK_RESUME_CONTENT,
  MOCK_COVER_LETTER,
} from "../mock/data";
import {
  RESUME_TEMPLATE_SEEDS,
  COVER_LETTER_TEMPLATE_SEEDS,
  DEFAULT_USAGE_LIMITS,
} from "../constants";

export interface LocalStore {
  profile: typeof MOCK_PROFILE & { id: string };
  companies: Array<{
    id: string;
    name: string;
    domain?: string;
    career_url?: string;
    trust_score: number;
    scan_enabled: boolean;
  }>;
  jobs: Array<{
    id: string;
    title: string;
    company_name: string;
    description: string;
    url?: string;
    status: string;
    fit_score?: number;
    trust_score?: number;
    source: string;
    idempotency_key: string;
    location?: string;
    remote_type?: string;
    decision?: string;
    scam_passed?: boolean;
    scam_score?: number;
    resume_template?: string;
    cover_letter_template?: string;
    decision_reason?: string;
    decision_reason_code?: string;
    duplicate_status?: string;
    description_hash?: string;
    date_found?: string;
    last_seen_at?: string;
    raw_email_ref?: string;
    department?: string;
  }>;
  applications: Array<{
    id: string;
    job_id: string;
    status: string;
    decision?: string;
    fit_score?: number;
    trust_score?: number;
    resume_match_score?: number;
    cover_letter_match_score?: number;
    decision_reason?: Record<string, string | boolean | undefined>;
  }>;
  resume_templates: Array<{
    id: string;
    name: string;
    slug: string;
    content: string;
    skills: string[];
    is_active: boolean;
  }>;
  cover_letter_templates: Array<{
    id: string;
    name: string;
    slug: string;
    content: string;
    is_active: boolean;
  }>;
  evidence_bank: Array<{
    id: string;
    category: string;
    title: string;
    content: string;
    skills: string[];
    tools: string[];
    proof?: string;
    approved: boolean;
  }>;
  autopilot_settings: {
    auto_apply_enabled: boolean;
    mock_mode: boolean;
    emergency_stop: boolean;
    password_storage_enabled: boolean;
    email_scanning_enabled: boolean;
    company_scanning_enabled: boolean;
    scan_unread_only: boolean;
    max_job_alert_emails_per_run: number;
    scan_email_lookback_days: number;
    max_company_pages_per_run: number;
    allowed_job_alert_senders: string[];
    blocked_job_alert_senders: string[];
    blocked_keywords: string[];
    allowed_role_keywords: string[];
    mark_processed_emails: boolean;
    use_gemini: boolean;
    dry_run: boolean;
    gemini_enabled: boolean;
    gmail_scanning_enabled: boolean;
    outreach_enabled: boolean;
  };
  agent_usage_limits: typeof DEFAULT_USAGE_LIMITS & {
    applications_today: number;
    outreach_today: number;
    jobs_analyzed_today: number;
    ai_calls_today: number;
    companies_scanned_today?: number;
    emails_scanned_today?: number;
    jobs_saved_today?: number;
    duplicates_skipped_today?: number;
    cache_hits_today?: number;
    db_writes_today?: number;
    db_reads_today?: number;
    estimated_cost_today?: number;
  };
  agent_runs: Array<{
    id: string;
    status: string;
    started_at: string;
    ended_at?: string;
    summary: Record<string, unknown>;
    mock_mode: boolean;
  }>;
  agent_logs: Array<{
    id: string;
    run_id: string;
    level: string;
    message: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  blocked_actions: Array<{
    id: string;
    job_id?: string;
    reason_code: string;
    reason_detail?: string;
    suggested_action?: string;
    resolved: boolean;
    created_at: string;
  }>;
  ai_cache: Array<{
    id: string;
    jd_hash: string;
    fit_score?: number;
    output: Record<string, unknown>;
  }>;
}

function uid() {
  return crypto.randomUUID();
}

/** Default in-memory store — safe to call from API routes and the agent CLI */
export function getDefaultStore(): LocalStore {
  return {
    profile: { id: "local-user", ...MOCK_PROFILE },
    companies: MOCK_COMPANIES.map((c) => ({
      id: uid(),
      ...c,
      scan_enabled: true,
    })),
    jobs: [],
    applications: [],
    resume_templates: RESUME_TEMPLATE_SEEDS.map((t) => ({
      id: uid(),
      name: t.name,
      slug: t.slug,
      content: MOCK_RESUME_CONTENT(t.name),
      skills: MOCK_PROFILE.skills.map((s) => s.toLowerCase()),
      is_active: t.active,
    })),
    cover_letter_templates: COVER_LETTER_TEMPLATE_SEEDS.map((t) => ({
      id: uid(),
      name: t.name,
      slug: t.slug,
      content: MOCK_COVER_LETTER(t.name),
      is_active: true,
    })),
    evidence_bank: MOCK_EVIDENCE.map((e, i) => ({
      id: `ev-${i}`,
      category: e.category,
      title: e.title,
      content: e.content,
      skills: e.skills ?? [],
      tools: e.tools ?? [],
      proof: e.proof,
      approved: e.approved ?? true,
    })),
    autopilot_settings: {
      auto_apply_enabled: false,
      mock_mode: true,
      emergency_stop: true,
      password_storage_enabled: false,
      email_scanning_enabled: true,
      company_scanning_enabled: true,
      scan_unread_only: false,
      max_job_alert_emails_per_run: 25,
      scan_email_lookback_days: 7,
      max_company_pages_per_run: 10,
      allowed_job_alert_senders: [],
      blocked_job_alert_senders: [],
      blocked_keywords: ["senior staff", "principal", "10+ years"],
      allowed_role_keywords: ["intern", "software", "engineer", "developer"],
      mark_processed_emails: false,
      use_gemini: false,
      dry_run: true,
      gemini_enabled: false,
      gmail_scanning_enabled: true,
      outreach_enabled: false,
    },
    agent_usage_limits: {
      ...DEFAULT_USAGE_LIMITS,
      applications_today: 0,
      outreach_today: 0,
      jobs_analyzed_today: 0,
      ai_calls_today: 0,
      companies_scanned_today: 0,
      emails_scanned_today: 0,
      jobs_saved_today: 0,
      duplicates_skipped_today: 0,
      cache_hits_today: 0,
      db_writes_today: 0,
      db_reads_today: 0,
      estimated_cost_today: 0,
    },
    agent_runs: [],
    agent_logs: [],
    blocked_actions: [],
    ai_cache: [],
  };
}
