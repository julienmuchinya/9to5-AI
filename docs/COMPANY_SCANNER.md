# Company Career Page Scanner (Part 3)

Scans **user-added** company career URLs and safe public ATS boards.

## Supported sources

- User career page URLs (Companies page)
- Greenhouse public boards
- Lever public boards
- Ashby public boards
- SmartRecruiters public boards
- Workday public job links (when accessible without bypassing protections)

## Mock mode

Returns seeded jobs from `MOCK_COMPANY_JOBS` for Acme Tech and CloudBase Inc.

## Live mode

- Conservative HTTP fetch with timeout
- Stops on captcha / bot-protection signals
- Logs blocked actions (`CAPTCHA_DETECTED`, `BLOCKED_WEBSITE`, etc.)
- Delay between company scans (human-like guard)

## Limits

- `max_company_pages_per_run` (Settings)
- Daily `maxCompaniesScannedPerDay` (Limits page)

## Adding companies

1. Open **Companies**
2. Add name + career URL (prefer Greenhouse/Lever/Ashby links)
3. Enable scan for each company

## API

`POST /api/companies/scan`

## What it will NOT do

- Scrape LinkedIn or Indeed
- Bypass captcha or bot protection
- Aggressive crawling
