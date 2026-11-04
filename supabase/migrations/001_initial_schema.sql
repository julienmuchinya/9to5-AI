-- 9to5 AI initial schema
-- Using gen_random_uuid() which is built-in to PostgreSQL 13+

-- profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  school TEXT DEFAULT 'Example State University',
  job_email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  github_url TEXT,
  location_preference TEXT DEFAULT 'us_nationwide',
  work_mode TEXT DEFAULT 'flexible',
  relocation BOOLEAN DEFAULT true,
  sponsorship_needed BOOLEAN DEFAULT false,
  target_roles TEXT[] DEFAULT '{}',
  skills TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  career_url TEXT,
  trust_score NUMERIC(5,2) DEFAULT 85,
  scan_enabled BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'discovered',
  jd_hash TEXT,
  idempotency_key TEXT NOT NULL,
  fit_score NUMERIC(5,2),
  trust_score NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, idempotency_key)
);

CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  decision TEXT,
  fit_score NUMERIC(5,2),
  trust_score NUMERIC(5,2),
  resume_match_score NUMERIC(5,2),
  cover_letter_match_score NUMERIC(5,2),
  decision_reason JSONB DEFAULT '{}',
  resume_version_id UUID,
  cover_letter_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE application_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  portal_name TEXT,
  login_url TEXT,
  username TEXT,
  email_used TEXT,
  password_manager_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE password_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_account_id UUID REFERENCES application_accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resume_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  skills TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT false,
  performance_score NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, slug)
);

CREATE TABLE resume_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  resume_template_id UUID REFERENCES resume_templates(id) ON DELETE SET NULL,
  company_name TEXT,
  job_title TEXT,
  content TEXT NOT NULL,
  ats_keywords TEXT[] DEFAULT '{}',
  projects_emphasized TEXT[] DEFAULT '{}',
  match_score NUMERIC(5,2),
  edit_tier TEXT DEFAULT 'none',
  outcome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cover_letter_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, slug)
);

CREATE TABLE cover_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  cover_letter_template_id UUID REFERENCES cover_letter_templates(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  match_score NUMERIC(5,2),
  reusable BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE application_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE application_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  channel TEXT,
  status TEXT DEFAULT 'pending',
  confirmation TEXT,
  error_message TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE outreach_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT NOT NULL,
  company TEXT,
  role TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE outreach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES outreach_contacts(id) ON DELETE SET NULL,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  body_hash TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE scam_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  passed BOOLEAN DEFAULT false,
  score NUMERIC(5,2),
  signals JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE best_answers_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_pattern TEXT NOT NULL,
  answer TEXT NOT NULL,
  use_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE autopilot_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  auto_apply_enabled BOOLEAN DEFAULT false,
  mock_mode BOOLEAN DEFAULT true,
  emergency_stop BOOLEAN DEFAULT true,
  active_resume_template_ids UUID[] DEFAULT '{}',
  gmail_connected BOOLEAN DEFAULT false,
  gmail_refresh_token_set BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_usage_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  max_applications_per_day INT DEFAULT 50,
  max_outreach_per_day INT DEFAULT 10,
  max_followups_per_day INT DEFAULT 10,
  max_jobs_analyzed_per_day INT DEFAULT 90,
  max_companies_scanned_per_day INT DEFAULT 80,
  max_ai_calls_per_day INT DEFAULT 50,
  max_db_writes_per_day INT DEFAULT 1000,
  max_db_reads_per_day INT DEFAULT 5000,
  max_storage_mb INT DEFAULT 400,
  max_cost_per_day NUMERIC(10,2) DEFAULT 0,
  max_cost_per_month NUMERIC(10,2) DEFAULT 0,
  applications_today INT DEFAULT 0,
  outreach_today INT DEFAULT 0,
  followups_today INT DEFAULT 0,
  jobs_analyzed_today INT DEFAULT 0,
  companies_scanned_today INT DEFAULT 0,
  ai_calls_today INT DEFAULT 0,
  db_writes_today INT DEFAULT 0,
  db_reads_today INT DEFAULT 0,
  usage_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metric TEXT NOT NULL,
  current_value INT NOT NULL,
  limit_value INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  summary JSONB DEFAULT '{}',
  mock_mode BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  level TEXT DEFAULT 'info',
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE blocked_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  reason_code TEXT NOT NULL,
  reason_detail TEXT,
  suggested_action TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE skill_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  missing_skills TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  purpose TEXT,
  output_schema JSONB,
  template_text TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, version)
);

CREATE TABLE evidence_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  skills TEXT[] DEFAULT '{}',
  tools TEXT[] DEFAULT '{}',
  proof TEXT,
  approved BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resume_match_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_template_id UUID REFERENCES resume_templates(id) ON DELETE SET NULL,
  scores JSONB DEFAULT '{}',
  best_score NUMERIC(5,2),
  decision_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cover_letter_match_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cover_letter_template_id UUID REFERENCES cover_letter_templates(id) ON DELETE SET NULL,
  scores JSONB DEFAULT '{}',
  best_score NUMERIC(5,2),
  decision_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jd_hash TEXT NOT NULL,
  selected_resume_template_id UUID,
  selected_cover_letter_template_id UUID,
  fit_score NUMERIC(5,2),
  prompt_version_id UUID REFERENCES prompt_versions(id),
  output JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, jd_hash)
);

CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_applications_user_status ON applications(user_id, status);
CREATE INDEX idx_agent_logs_run ON agent_logs(run_id, created_at DESC);
CREATE INDEX idx_ai_cache_hash ON ai_cache(user_id, jd_hash);
CREATE INDEX idx_blocked_actions_user ON blocked_actions(user_id, resolved);

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cover_letter_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cover_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE scam_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE best_answers_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE autopilot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_usage_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE cover_letter_match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_own ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY companies_own ON companies FOR ALL USING (auth.uid() = user_id);
CREATE POLICY jobs_own ON jobs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY applications_own ON applications FOR ALL USING (auth.uid() = user_id);
CREATE POLICY application_accounts_own ON application_accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY password_access_logs_own ON password_access_logs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY resume_templates_own ON resume_templates FOR ALL USING (auth.uid() = user_id);
CREATE POLICY resume_versions_own ON resume_versions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY cover_letter_templates_own ON cover_letter_templates FOR ALL USING (auth.uid() = user_id);
CREATE POLICY cover_letters_own ON cover_letters FOR ALL USING (auth.uid() = user_id);
CREATE POLICY application_answers_own ON application_answers FOR ALL USING (auth.uid() = user_id);
CREATE POLICY application_submissions_own ON application_submissions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY outreach_contacts_own ON outreach_contacts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY outreach_messages_own ON outreach_messages FOR ALL USING (auth.uid() = user_id);
CREATE POLICY followups_own ON followups FOR ALL USING (auth.uid() = user_id);
CREATE POLICY scam_checks_own ON scam_checks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY best_answers_own ON best_answers_library FOR ALL USING (auth.uid() = user_id);
CREATE POLICY autopilot_settings_own ON autopilot_settings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY agent_usage_limits_own ON agent_usage_limits FOR ALL USING (auth.uid() = user_id);
CREATE POLICY agent_limit_events_own ON agent_limit_events FOR ALL USING (auth.uid() = user_id);
CREATE POLICY agent_runs_own ON agent_runs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY agent_logs_own ON agent_logs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY blocked_actions_own ON blocked_actions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY skill_gaps_own ON skill_gaps FOR ALL USING (auth.uid() = user_id);
CREATE POLICY evidence_bank_own ON evidence_bank FOR ALL USING (auth.uid() = user_id);
CREATE POLICY resume_match_results_own ON resume_match_results FOR ALL USING (auth.uid() = user_id);
CREATE POLICY cover_letter_match_results_own ON cover_letter_match_results FOR ALL USING (auth.uid() = user_id);
CREATE POLICY ai_cache_own ON ai_cache FOR ALL USING (auth.uid() = user_id);

CREATE POLICY prompt_versions_read ON prompt_versions FOR SELECT USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER jobs_updated BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER applications_updated BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION update_updated_at();

