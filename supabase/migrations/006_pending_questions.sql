-- 9to5 AI v2.3: questions the agent couldn't answer, and the user's answers to them.
-- Safe to re-run.

ALTER TABLE applications
  -- Required questions the agent had no answer for: [{key,label,kind,options,required}].
  ADD COLUMN IF NOT EXISTS pending_questions JSONB;

ALTER TABLE profiles
  -- The user's own answers to questions found on forms, keyed by normalised question text:
  -- {"<key>": {"q": "<question as asked>", "a": "<answer>", "at": "<iso time>"}}.
  -- Reused for the same or a very similar question on every later application.
  ADD COLUMN IF NOT EXISTS custom_answers JSONB DEFAULT '{}'::jsonb;
