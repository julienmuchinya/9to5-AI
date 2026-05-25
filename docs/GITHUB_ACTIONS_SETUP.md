# GitHub Actions — 9to5 AI Daily Agent

Workflow: `.github/workflows/daily-agent.yml`

## Safe defaults

- Scheduled cron runs **mock** agent only.
- `workflow_dispatch` defaults: `mode=mock`, `dry_run=true`.
- Live runs require **both**:
  - Manual `mode=live` input, and
  - Repository secret `LIVE_AGENT_ENABLED=true`

## Repository secrets

| Secret | Required for | Notes |
|--------|----------------|-------|
| `AGENT_SECRET` | All modes | Min 8 chars; never log |
| `LIVE_AGENT_ENABLED` | Live only | Set to `true` only when ready |
| `NEXT_PUBLIC_SUPABASE_URL` | Live | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Live | |
| `SUPABASE_SERVICE_ROLE_KEY` | Live | Server only |
| `AGENT_USER_ID` | Live | UUID for data rows |
| `GEMINI_API_KEY` | Optional live | Only if AI enabled |
| `GMAIL_REFRESH_TOKEN` | Optional live | Job-search account only |

## Run mock daily (recommended)

1. Actions → **9to5 AI Daily Agent** → Run workflow
2. Leave `mode=mock`, `dry_run=true`

Or wait for cron (12:00 UTC) — runs mock automatically.

## Enable live later

1. Complete Supabase + setup checklist.
2. Add all live secrets above.
3. Set `LIVE_AGENT_ENABLED=true`.
4. Run workflow manually with `mode=live`, `dry_run=true` first.
5. Only then set `dry_run=false` when you accept live persistence.

## What live does NOT do (Part 2)

- No Playwright application submission
- No captcha bypass
- No LinkedIn/Indeed automation
- No outreach emails unless explicitly enabled later
