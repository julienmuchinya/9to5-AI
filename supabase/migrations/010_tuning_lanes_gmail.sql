-- 9to5 AI: your own settings for how jobs are picked, scheduled runs and your own runs side by side,
-- and remembering what Google allowed. The app works without this file (with the old behavior).

-- Settings → "How the agent picks jobs": posting age, per-company limit, order, focus / your requests first.
ALTER TABLE autopilot_settings ADD COLUMN IF NOT EXISTS tuning JSONB DEFAULT '{}'::jsonb;

-- A run claims a job before filling the form, so a scheduled run and your own "Run now" run
-- never send the same application. Cleared when the attempt ends; expires after 20 minutes.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applying_until TIMESTAMPTZ;

-- What "Connect with Google" was allowed to do (read, send). Without send permission the daily summary
-- email is skipped quietly instead of failing on every run.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS inbox_scopes TEXT;
