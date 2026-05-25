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
