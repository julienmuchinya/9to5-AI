-- Placeholder evidence rows; replace with your approved facts
INSERT INTO evidence_bank (user_id, category, title, content, skills, tools, approved)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'project', 'Sample Project', 'Describe a real project with proof link', ARRAY['React'], ARRAY['Git'], true)
ON CONFLICT DO NOTHING;
