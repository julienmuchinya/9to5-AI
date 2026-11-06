-- 9to5 AI v2.2: saved answers to common application questions + remembered AI answers.
-- Safe to re-run.

ALTER TABLE profiles
  -- The user's own answers (Profile → Common application questions), keyed by question key.
  ADD COLUMN IF NOT EXISTS application_answers JSONB DEFAULT '{}'::jsonb,
  -- Answers the AI gave to generic questions before, keyed by normalised question text,
  -- so the same question never costs a second AI call.
  ADD COLUMN IF NOT EXISTS answer_memory JSONB DEFAULT '{}'::jsonb;

-- Faster "freshest first" ordering of the shared job pool.
CREATE INDEX IF NOT EXISTS idx_job_postings_posted ON job_postings(posted_at DESC) WHERE active;
