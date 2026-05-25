# 9to5 AI Architecture

## Overview

**9to5 AI** is a cloud job application agent with a Next.js dashboard. The dashboard is the control panel only; the agent runs on a schedule via GitHub Actions (or manually via API/local script).

## Components

| Component | Location | Role |
|-----------|----------|------|
| Dashboard | `src/app/` | Setup, libraries, review, logs |
| Shared engines | `src/lib/engines/` | Fit, trust, scam, decision, resume/CL match |
| Cloud agent | `agent/run.ts`, `agent/pipeline.ts` | Daily automation |
| Database | `supabase/migrations/` | Postgres + RLS |
| CI runner | `.github/workflows/daily-agent.yml` | Cron schedule |

## Data flow

1. Gmail scanner ingests job alerts (mock or live).
2. Jobs deduped by idempotency key.
3. Scam → trust → fit → resume/CL match → truth filter → decision.
4. Results stored in applications, blocked_actions, agent_logs.
5. AI cache reduces Gemini calls.

## Free-first

- Mock mode by default
- $0 cost cap in budget guard
- Template/cache before Gemini

## Branding

Product name: **9to5 AI** (repo folder: `9to5-AI`, npm package: `9to5-ai`).
