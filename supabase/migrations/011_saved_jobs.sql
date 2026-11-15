-- Saved jobs: a bookmark on a matched job, shown as the "Saved" filter on Find Jobs.
-- Safe to run more than once. The app works before this runs (the Saved filter just stays hidden).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS jobs_user_saved_idx ON public.jobs (user_id, saved_at DESC) WHERE saved_at IS NOT NULL;
