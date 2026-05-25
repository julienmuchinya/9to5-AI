# Deployment — 9to5 AI

## Vercel (recommended)

1. Import the GitHub repository in [Vercel](https://vercel.com).
2. Framework preset: **Next.js**.
3. Add environment variables from `.env.example`:
   - `NEXT_PUBLIC_MOCK_MODE=true` until production-ready
   - `NEXT_PUBLIC_APP_URL=https://your-app.vercel.app`
   - `AGENT_SECRET` (random 32+ chars)
   - Supabase keys when using live mode
4. Deploy.

## Verify after deploy

- Home and Dashboard load.
- Mock banner shows when `NEXT_PUBLIC_MOCK_MODE=true`.
- `/setup` checklist renders.
- `/api/setup/status` returns JSON (no secrets).

## Custom domain

Optional. Default `*.vercel.app` URL is fine for Part 2.

## Live production

Before `NEXT_PUBLIC_MOCK_MODE=false`:

1. Complete `docs/SUPABASE_SETUP.md`
2. Complete setup checklist in the app
3. Configure `docs/GITHUB_ACTIONS_SETUP.md` with `LIVE_AGENT_ENABLED` only when ready

## Safety defaults

- Autopilot **off**
- Emergency stop **on** in live mode until you disable it
- Cost limit **$0**
- No real auto-apply in Part 2
