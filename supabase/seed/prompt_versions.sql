INSERT INTO prompt_versions (name, version, purpose, output_schema, is_active) VALUES
  ('job_fit', 'v1', 'Score job fit 0-100', '{"fitScore": "number"}', true),
  ('jd_extract', 'v1', 'Extract skills from JD', '{"required": [], "preferred": []}', true),
  ('resume_tailor', 'v1', 'Tailor resume keywords', '{"content": "string"}', true),
  ('cover_letter', 'v1', 'Generate cover letter', '{"content": "string"}', true),
  ('outreach', 'v1', 'Recruiter outreach', '{"body": "string"}', true),
  ('scam_nlp', 'v1', 'Scam signal assist', '{"signals": []}', true),
  ('trust_company', 'v1', 'Company trust assist', '{"score": "number"}', true)
ON CONFLICT (name, version) DO NOTHING;
