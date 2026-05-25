# Gmail Job Alert Scanner (Part 3)

9to5 AI scans **job-alert emails only** — never your full personal inbox.

## How it works

1. Builds a scoped Gmail search query (job/intern keywords, last N days, optional unread-only).
2. Filters by allowed senders (LinkedIn, Indeed, Handshake, Glassdoor, Wellfound, Simplify, Google, company alerts).
3. Parses company, title, URL, location, remote type, and description.
4. **Blocks** LinkedIn/Indeed **job page URLs** — email alerts are allowed; website scraping is not.

## Mock mode

Set `MOCK_MODE=true`. The scanner uses seeded mock emails in `src/lib/mock/data.ts` — **no Gmail API calls**.

## Live mode

Requires:

- Gmail OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`)
- Job-search email in Profile
- `LIVE_AGENT_ENABLED=true` and complete setup checklist
- `AGENT_SECRET` for API/CI runs

## Settings

Configure on **Settings**:

- Email scanning enabled
- Scan unread only
- Max emails per run
- Lookback days (default 7)
- Allowed/blocked senders and keywords
- Mark processed emails as read (default **OFF**)

## API

`POST /api/email/scan-job-alerts` — respects mock mode, emergency stop, budget guard, and live run guard.

## What it will NOT do

- Read non-job mail
- Delete or reply to emails
- Send outreach
- Submit applications
