-- Default autopilot: off, emergency stop on, mock until user configures live
INSERT INTO autopilot_settings (user_id, auto_apply_enabled, mock_mode, emergency_stop)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  false,
  true,
  true
)
ON CONFLICT (user_id) DO NOTHING;
