# 9to5 AI

A job-search agent for any field — tech, healthcare, trades, energy, finance, sales, retail and more: it finds fresh US job postings that match your resume and the roles you pick, checks the employer is real, and fills in and submits applications for you. The **dashboard** (Next.js on Vercel) is where you upload your resume, set what jobs you want, chat with the agent and follow your applications; the **agent** runs on GitHub Actions every few hours, even when the dashboard is closed.

## What it does

- **Finds jobs** for every role you list (pick from a catalog by field or type any title): curated new-grad lists, company job boards (Greenhouse, Lever, Ashby), 60+ large employers' Workday sites across energy, healthcare, banking, retail, government and tech, and remote-job feeds. Postings older than 2 weeks are skipped.
- **Checks them** for scam signs and unknown employers before anything is sent.
- **Matches them** to your resume, levels, locations and pay floor; the role you last asked for in chat goes first.
- **Applies** on Greenhouse, Lever, Ashby, Workday, Workable, Rippling, JazzHR and Jobvite (or "Apply to all matches" in one click) — resume picked or lightly tailored per job (never invented), common questions answered from your profile. Anything it can't finish goes to **Needs you**.
- **Tracks replies** from your Gmail (received, interview, rejection) and sends a daily summary.

## Stack

Next.js (App Router) · TypeScript · Tailwind · Supabase (Postgres + auth + storage) · Playwright · Gemini with a free Groq/OpenRouter fallback · GitHub Actions.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your own keys — never commit this file
npm run dev
```

1. Create a Supabase project and run the SQL files in `supabase/migrations/` in order.
2. Add the keys from `.env.example` to `.env.local` (dashboard) and to the repo's **GitHub Actions secrets** (agent).
3. Deploy the dashboard (e.g. Vercel) and sign in.

Run the agent locally: `npm run agent` (or `npm run agent:dry` to fill forms without submitting).

## Project structure

```
src/app/                 Dashboard pages and API routes (chat, resume, Google connect)
src/lib/v2/              Matching, priorities, verification, AI, resumes, questions
src/lib/v2/discovery/    Job sources and filters
agent/v2/                The agent: discover → match → apply → inbox → summary
supabase/migrations/     Database schema
.github/workflows/       Agent schedule
```

## Safety

Auto-submit is off until you turn it on. Daily caps, per-company caps, site cooldowns after a CAPTCHA, and free-tier guards for AI and GitHub minutes all apply. On a public repo the agent's logs show only counts — no companies, questions or personal details.

## License

All rights reserved — see [LICENSE](LICENSE). The code is public for viewing only; no copying or reuse without permission.
