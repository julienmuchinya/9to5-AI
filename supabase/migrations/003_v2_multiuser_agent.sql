-- 9to5 AI v2: multi-user accounts, resume parsing, automatic discovery,
-- verification, auto-submit queue, chat, and free-tier usage tracking.
-- Safe to run more than once.

-- ── Profiles: resume + preferences ─────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS work_authorized_us BOOLEAN,
  ADD COLUMN IF NOT EXISTS graduation_date TEXT,
  ADD COLUMN IF NOT EXISTS resume_path TEXT,
  ADD COLUMN IF NOT EXISTS resume_text TEXT,
  ADD COLUMN IF NOT EXISTS resume_parsed JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS resume_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS job_levels TEXT[] DEFAULT ARRAY['internship','new_grad','entry']::text[],
  ADD COLUMN IF NOT EXISTS min_salary INT DEFAULT 80000,
  ADD COLUMN IF NOT EXISTS locations TEXT[] DEFAULT ARRAY['remote_us','GA']::text[],
  ADD COLUMN IF NOT EXISTS keywords_include TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS keywords_exclude TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_companies TEXT[] DEFAULT '{}';

-- ── Autopilot: auto-submit controls (off by default) ───────────────────────
ALTER TABLE autopilot_settings
  ADD COLUMN IF NOT EXISTS auto_submit_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_apply_cap INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS min_fit_score INT DEFAULT 65,
  ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT false;

-- ── Shared job pool (one copy per posting, used by every account) ──────────
CREATE TABLE IF NOT EXISTS job_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  company_domain TEXT,
  title TEXT NOT NULL,
  level TEXT,
  locations TEXT[] DEFAULT '{}',
  is_remote BOOLEAN DEFAULT false,
  url TEXT NOT NULL,
  apply_url TEXT,
  ats TEXT,
  ats_board TEXT,
  salary_min INT,
  salary_max INT,
  description TEXT,
  posted_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  active BOOLEAN DEFAULT true,
  verification_status TEXT DEFAULT 'pending',
  verification_score INT,
  verification_signals JSONB DEFAULT '[]',
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_job_postings_active ON job_postings(active, verification_status, last_seen_at DESC);

-- Company verification cache (shared).
CREATE TABLE IF NOT EXISTS company_verifications (
  company_key TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  domain TEXT,
  status TEXT NOT NULL,
  score INT,
  signals JSONB DEFAULT '[]',
  checked_at TIMESTAMPTZ DEFAULT now()
);

-- ── Per-user job matches ───────────────────────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS posting_id UUID REFERENCES job_postings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS fit_reasons JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_jobs_user_fit ON jobs(user_id, fit_score DESC);

-- ── Applications: queue + submission result ────────────────────────────────
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS posting_id UUID REFERENCES job_postings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS apply_url TEXT,
  ADD COLUMN IF NOT EXISTS ats TEXT,
  ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_by TEXT DEFAULT 'agent';
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_user_job ON applications(user_id, job_id);

-- ── Chat history ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  actions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id, created_at DESC);

-- ── Free-tier usage counters ───────────────────────────────────────────────
-- scope = 'global' or a user id; period = 'YYYY-MM-DD' or 'YYYY-MM'.
CREATE TABLE IF NOT EXISTS usage_counters (
  scope TEXT NOT NULL,
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (scope, metric, period)
);

CREATE OR REPLACE FUNCTION increment_usage(p_scope TEXT, p_metric TEXT, p_period TEXT, p_by BIGINT)
RETURNS BIGINT LANGUAGE sql AS $$
  INSERT INTO usage_counters (scope, metric, period, value)
  VALUES (p_scope, p_metric, p_period, p_by)
  ON CONFLICT (scope, metric, period)
  DO UPDATE SET value = usage_counters.value + EXCLUDED.value, updated_at = now()
  RETURNING value;
$$;

-- Database + storage size, for the free-tier monitor.
CREATE OR REPLACE FUNCTION free_tier_sizes()
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', COALESCE((SELECT sum((metadata->>'size')::bigint) FROM storage.objects), 0),
    'users', (SELECT count(*) FROM auth.users)
  );
$$;

-- ── Row level security ─────────────────────────────────────────────────────
ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_postings_read ON job_postings;
CREATE POLICY job_postings_read ON job_postings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS company_verifications_read ON company_verifications;
CREATE POLICY company_verifications_read ON company_verifications FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS chat_messages_own ON chat_messages;
CREATE POLICY chat_messages_own ON chat_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS usage_counters_read ON usage_counters;
CREATE POLICY usage_counters_read ON usage_counters FOR SELECT TO authenticated
  USING (scope = 'global' OR scope = auth.uid()::text);

-- Policies the original schema left out.
DROP POLICY IF EXISTS evidence_bank_own ON evidence_bank;
CREATE POLICY evidence_bank_own ON evidence_bank FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS agent_runs_own ON agent_runs;
CREATE POLICY agent_runs_own ON agent_runs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS agent_logs_own ON agent_logs;
CREATE POLICY agent_logs_own ON agent_logs FOR SELECT USING (auth.uid() = user_id);

GRANT ALL ON job_postings, company_verifications, chat_messages, usage_counters TO service_role;
GRANT SELECT ON job_postings, company_verifications, usage_counters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_messages TO authenticated;
GRANT EXECUTE ON FUNCTION increment_usage(TEXT, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION free_tier_sizes() TO service_role, authenticated;

-- ── New account → profile + settings rows ──────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, job_email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO autopilot_settings (user_id, auto_apply_enabled, mock_mode, emergency_stop)
  VALUES (NEW.id, false, false, false)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Private resume storage (each user can only touch their own folder) ─────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('resumes', 'resumes', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS resumes_own_read ON storage.objects;
CREATE POLICY resumes_own_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS resumes_own_write ON storage.objects;
CREATE POLICY resumes_own_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS resumes_own_update ON storage.objects;
CREATE POLICY resumes_own_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS resumes_own_delete ON storage.objects;
CREATE POLICY resumes_own_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
