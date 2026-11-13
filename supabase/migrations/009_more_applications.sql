-- 9to5 AI: apply to many more matches, for people in any field.
-- New accounts: up to 100 applications a day (was 5), fit score 55+ (was 65), pay floor $40K (was $80K),
-- "In my state" instead of Georgia. The app works without this file; it only changes the starting values.
ALTER TABLE autopilot_settings ALTER COLUMN daily_apply_cap SET DEFAULT 100;
ALTER TABLE autopilot_settings ALTER COLUMN min_fit_score SET DEFAULT 55;
ALTER TABLE profiles ALTER COLUMN min_salary SET DEFAULT 40000;
ALTER TABLE profiles ALTER COLUMN locations SET DEFAULT ARRAY['remote_us','my_state']::text[];
ALTER TABLE profiles ALTER COLUMN school DROP DEFAULT;

-- Existing accounts still on the old starting cap (5 or less) move up to 100. A cap someone chose
-- themselves (anything above 5) is left alone. Change it any time on Settings.
UPDATE autopilot_settings SET daily_apply_cap = 100 WHERE daily_apply_cap IS NULL OR daily_apply_cap <= 5;
