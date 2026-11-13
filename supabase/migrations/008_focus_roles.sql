-- 9to5 AI: focus roles — the kind of job the user asked for most recently (chat "go apply to oil field
-- jobs", or Resume & profile). Matching jobs go before everything else, at any US location.
-- The app works without this column (the roles are still added to target_roles), just without the priority.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS focus_roles TEXT[] DEFAULT '{}';
