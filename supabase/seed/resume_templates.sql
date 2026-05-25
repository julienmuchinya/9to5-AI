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
