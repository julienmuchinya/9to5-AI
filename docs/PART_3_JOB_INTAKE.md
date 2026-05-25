# Part 3 — Job Intake & Daily Agent Runner

Part 3 finds jobs, analyzes them, saves them, and prepares decisions for **Part 4** auto-apply.

## Pipeline (20 steps)

1. Start agent run  
2. Emergency stop check  
3. Setup checklist  
4. Budget guard  
5. Gmail job-alert scan  
6. Company career scan  
7. Normalize jobs  
8. Deduplicate  
9. Save new jobs  
10. Scam check  
11. Company trust  
12. Job fit  
13. Resume template selection  
14. Cover letter template selection  
15. Truth / evidence filter  
16. Decision: `AUTO_APPLY_READY`, `REVIEW_ONLY`, `SKIP`, `BLOCKED`  
17. Save scores and reasons on job record  
18. Blocked actions if needed  
19. Agent logs per step  
20. End run with summary  

## Decisions (no submission)

| Decision | Meaning |
|----------|---------|
| `AUTO_APPLY_READY` | Ready for Part 4 — **not submitted in Part 3** |
| `REVIEW_ONLY` | Human review before any apply |
| `SKIP` | Low fit or filtered out |
| `BLOCKED` | Trust, scam, captcha, budget, etc. |

## Run mock scan locally

```bash
npm run agent:mock
```

Or use **Agent Logs → Run agent now** in the dashboard.

## Run live scan later (safe)

1. Complete setup checklist  
2. Set `LIVE_AGENT_ENABLED=true` in GitHub secrets  
3. Configure Supabase + Gmail + optional Gemini  
4. Use GitHub Actions `workflow_dispatch` with `mode=live` and `dry_run=true` first  
5. Only set `dry_run=false` when intentional  

## GitHub Actions inputs

- `mode`: mock (default) / live  
- `dry_run`: true (default) / false  
- `scan_email`: true (default) / false  
- `scan_companies`: true (default) / false  

## Not in Part 3

- Real auto-apply / Playwright  
- Outreach emails  
- Password storage  
- LinkedIn/Indeed scraping  
