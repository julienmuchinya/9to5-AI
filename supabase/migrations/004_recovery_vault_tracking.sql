-- 9to5 AI v2.1: password recovery questions, portal-login vault, application tracking, site cooldowns.
-- Run once in Supabase → SQL Editor. Safe to re-run.

-- ── Security questions (server-only: RLS on, no client policies) ───────────
CREATE TABLE IF NOT EXISTS security_questions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_lc TEXT NOT NULL,
  q1 TEXT NOT NULL, a1_hash TEXT NOT NULL,
  q2 TEXT NOT NULL, a2_hash TEXT NOT NULL,
  q3 TEXT NOT NULL, a3_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_questions_email ON security_questions(email_lc);
ALTER TABLE security_questions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS password_reset_attempts (
  id BIGSERIAL PRIMARY KEY,
  email_lc TEXT NOT NULL,
  method TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reset_attempts_email ON password_reset_attempts(email_lc, created_at DESC);
ALTER TABLE password_reset_attempts ENABLE ROW LEVEL SECURITY;

-- ── Career-portal logins (passwords AES-256-GCM encrypted by the server) ───
ALTER TABLE application_accounts
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS portal_host TEXT,
  ADD COLUMN IF NOT EXISTS password_enc TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS account_created BOOLEAN DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_accounts_host ON application_accounts(user_id, portal_host);

-- ── Application tracking ───────────────────────────────────────────────────
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS resume_focus TEXT,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS application_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,          -- submitted | received | under_review | interview | offer | rejected | note
  source TEXT NOT NULL,        -- agent | email | user
  detail TEXT,
  message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_events_app ON application_events(application_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_events_msg ON application_events(user_id, message_id) WHERE message_id IS NOT NULL;
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS application_events_own ON application_events;
CREATE POLICY application_events_own ON application_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Inbox connection for status tracking (app password stored encrypted).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS inbox_email TEXT,
  ADD COLUMN IF NOT EXISTS inbox_host TEXT DEFAULT 'imap.gmail.com',
  ADD COLUMN IF NOT EXISTS inbox_password_enc TEXT,
  ADD COLUMN IF NOT EXISTS inbox_last_scan_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inbox_error TEXT;

-- ── Anti-ban: per-site cooldowns shared by all users ───────────────────────
CREATE TABLE IF NOT EXISTS site_cooldowns (
  host TEXT PRIMARY KEY,
  until TIMESTAMPTZ NOT NULL,
  reason TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE site_cooldowns ENABLE ROW LEVEL SECURITY;

-- ── Grants ─────────────────────────────────────────────────────────────────
GRANT ALL ON security_questions, password_reset_attempts, site_cooldowns, application_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE password_reset_attempts_id_seq TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON application_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON application_accounts TO authenticated;
GRANT ALL ON application_accounts TO service_role;
GRANT SELECT, INSERT ON password_access_logs TO authenticated;
GRANT ALL ON password_access_logs TO service_role;
