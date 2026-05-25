# Supabase Setup — 9to5 AI

## 1. Create a project

1. Go to [https://supabase.com](https://supabase.com) and create a new project.
2. Note the **Project URL** and **anon public** key from Settings → API.

## 2. Environment variables

Add to `.env.local` (never commit real keys):

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AGENT_USER_ID=00000000-0000-4000-8000-000000000001
```

The **service role key** is server-only (agent, API routes, GitHub Actions). Never add it to client code or `NEXT_PUBLIC_*` variables.

## 3. Run migrations

In Supabase SQL Editor, run:

1. `supabase/migrations/001_initial_schema.sql`

If Part 2 adds tables, also run `002_part2_supabase_persistence.sql` (if present).

## 4. Run seed files

Run in order:

1. `supabase/seed/default_profile.sql`
2. `supabase/seed/autopilot_settings.sql`
3. `supabase/seed/resume_templates.sql`
4. `supabase/seed/cover_letter_templates.sql`
5. `supabase/seed/evidence_bank.sql`
6. `supabase/seed/prompt_versions.sql`

Replace `AGENT_USER_ID` in seeds with your Supabase auth user UUID when using real auth.

## 5. Enable RLS

Migration `001_initial_schema.sql` enables RLS on user tables. Verify in Table Editor → each table → RLS enabled.

## 6. Verify

- Dashboard **Setup** page shows Supabase connected.
- `GET /api/setup/status` returns `databaseReachable` when configured.
- Required tables exist (profiles, jobs, applications, agent_runs, etc.).

## 7. Switch to live mode

Set `NEXT_PUBLIC_MOCK_MODE=false` only after checklist is complete.
