-- 9to5 AI: one-time setup fix. Paste all of this into Supabase SQL Editor and click Run.
-- Safe to run more than once.

-- 1) Let the app's server key (service_role) read and write the tables.
GRANT USAGE ON SCHEMA public TO service_role, authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- 2) Create the agent's user (fixed ID used by the app and the seed data).
INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'agent@9to5-ai.local', now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- 3) Part 2 settings columns (from migration 002; skipped if already there).
ALTER TABLE autopilot_settings
  ADD COLUMN IF NOT EXISTS password_storage_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gemini_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_scanning_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS outreach_enabled BOOLEAN DEFAULT false;

-- 4) Starter data (profile, templates, settings).

-- seed: default_profile
INSERT INTO profiles (id, full_name, school, job_email, location_preference, relocation, sponsorship_needed, target_roles, skills)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Your Name',
  'Example State University',
  'jobs@your-job-search-account.com',
  'us_nationwide',
  true,
  false,
  ARRAY['Software Engineer Intern', 'Backend Developer Intern']::text[],
  ARRAY['Java', 'Python', 'React', 'PostgreSQL']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- seed: autopilot_settings
-- Default autopilot: off, emergency stop on, mock until user configures live
INSERT INTO autopilot_settings (user_id, auto_apply_enabled, mock_mode, emergency_stop)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  false,
  true,
  true
)
ON CONFLICT (user_id) DO NOTHING;

-- seed: resume_templates
-- Seed resume template names; content filled via dashboard import
INSERT INTO resume_templates (user_id, name, slug, content, skills, is_active)
SELECT
  '00000000-0000-4000-8000-000000000001',
  name,
  slug,
  'Template content — edit in 9to5 AI dashboard',
  ARRAY['java','python','react','postgresql']::text[],
  active
FROM (VALUES
  ('Software Engineering Intern', 'swe-intern', true),
  ('Backend Developer', 'backend', true),
  ('Frontend Developer', 'frontend', true),
  ('Full Stack Developer', 'fullstack', true),
  ('Cloud / DevOps', 'cloud-devops', true)
) AS t(name, slug, active)
ON CONFLICT DO NOTHING;

-- seed: cover_letter_templates
INSERT INTO cover_letter_templates (user_id, name, slug, content, is_active)
SELECT
  '00000000-0000-4000-8000-000000000001',
  name,
  slug,
  'Cover letter template — customize in dashboard',
  true
FROM (VALUES
  ('Software Engineering', 'swe'),
  ('Backend Development', 'backend'),
  ('Frontend Development', 'frontend'),
  ('Cloud / DevOps', 'cloud-devops'),
  ('Data Analyst', 'data-analyst')
) AS t(name, slug)
ON CONFLICT DO NOTHING;

-- seed: evidence_bank
-- Placeholder evidence rows; replace with your approved facts
INSERT INTO evidence_bank (user_id, category, title, content, skills, tools, approved)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'project', 'Sample Project', 'Describe a real project with proof link', ARRAY['React'], ARRAY['Git'], true)
ON CONFLICT DO NOTHING;

-- seed: prompt_versions
INSERT INTO prompt_versions (name, version, purpose, output_schema, is_active) VALUES
  ('job_fit', 'v1', 'Score job fit 0-100', '{"fitScore": "number"}', true),
  ('jd_extract', 'v1', 'Extract skills from JD', '{"required": [], "preferred": []}', true),
  ('resume_tailor', 'v1', 'Tailor resume keywords', '{"content": "string"}', true),
  ('cover_letter', 'v1', 'Generate cover letter', '{"content": "string"}', true),
  ('outreach', 'v1', 'Recruiter outreach', '{"body": "string"}', true),
  ('scam_nlp', 'v1', 'Scam signal assist', '{"signals": []}', true),
  ('trust_company', 'v1', 'Company trust assist', '{"score": "number"}', true)
ON CONFLICT (name, version) DO NOTHING;
