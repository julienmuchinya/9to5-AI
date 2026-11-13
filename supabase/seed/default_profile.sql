INSERT INTO profiles (id, full_name, school, job_email, location_preference, relocation, sponsorship_needed, target_roles, skills)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Your Name',
  'Your University',
  'jobs@your-job-search-account.com',
  'us_nationwide',
  true,
  false,
  ARRAY['Software Engineer Intern', 'Backend Developer Intern']::text[],
  ARRAY['Java', 'Python', 'React', 'PostgreSQL']::text[]
)
ON CONFLICT (id) DO NOTHING;
