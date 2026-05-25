-- Part 2: optional settings columns for 9to5 AI live mode
ALTER TABLE autopilot_settings
  ADD COLUMN IF NOT EXISTS password_storage_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gemini_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_scanning_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS outreach_enabled BOOLEAN DEFAULT false;
