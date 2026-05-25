# 9to5 AI

Cloud-based AI job application agent for tech internships and junior roles. The **dashboard** is your control panel; the **9to5 AI agent** runs on a daily schedule (GitHub Actions) even when the dashboard is closed.

## Features

- Job alert ingestion (Gmail) and company watchlist
- Job fit, company trust, and scam detection engines
- Resume Library (15 templates) and Cover Letter Library
- Evidence Bank — truth-bound claims only
- AI cache to minimize Gemini usage
- Budget guard ($0 default), spam guard, emergency stop
- Auto-apply **OFF by default** until you enable it
- Mock mode for testing without API keys

## Stack

- Next.js App Router, TypeScript, Tailwind CSS
- Supabase (database, optional auth)
- Gemini API (optional; mock mode available)
- Gmail API OAuth
- GitHub Actions daily runner

## Quick start

```bash
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_MOCK_MODE=true for local testing
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → Dashboard → Setup checklist.

### Run agent locally (mock)

```bash
npm run agent:mock
```

Or trigger from **Agent Logs** → Run agent now.

### Supabase

1. Create a Supabase project (free tier).
2. Run `supabase/migrations/001_initial_schema.sql` in the SQL editor.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.local`.

### GitHub Actions

Add secrets from `.env.example`, then enable `.github/workflows/daily-agent.yml` (runs daily 12:00 UTC).

## Project structure

```
src/app/          Dashboard pages
src/lib/engines/  Scoring and safety engines
src/lib/mock/     Mock data for demo mode
agent/            Cloud agent pipeline
supabase/         SQL migrations
.github/          Daily agent workflow
```

## License

MIT — see [LICENSE](LICENSE).
