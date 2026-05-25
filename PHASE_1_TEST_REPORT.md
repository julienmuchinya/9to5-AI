# 9to5 AI — Phase 1 Verification & Production-Readiness Report

**Date:** 2026-05-20  
**Scope:** Phase 1 only (dashboard, libraries, mock mode, engines, agent pipeline, GitHub Actions safe default). No new major features added.

---

## 1. What Was Tested

### Automated (28 tests, all passing)

| Suite | Coverage |
|-------|----------|
| `src/lib/constants.test.ts` | 15 resume templates / 5 active, 9 cover letters, $0 cost default, password storage disabled |
| `src/lib/setup-checklist.test.ts` | Incomplete profile blocks completion; mock mode skips Supabase/Gmail/CI items |
| `src/lib/engines/decision.test.ts` | EMERGENCY_STOP, BLOCKED (trust), SKIP, AUTO_APPLY, REVIEW |
| `src/lib/engines/scam-check.test.ts` | SSN scam fail; normal JD pass |
| `src/lib/engines/budget-guard.test.ts` | Stop at 100%; warn at 80% |
| `src/lib/engines/job-fit.test.ts` | High/low fit scoring |
| `src/lib/engines/resume-selector.test.ts` | Backend template wins on backend JD |
| `src/lib/engines/sponsorship-guard.test.ts` | Detects sponsorship; blocks unanswered auto-answer |
| `src/lib/utils/hash.test.ts` | Idempotency key stability |
| `agent/pipeline.test.ts` | Emergency stop, no Gemini in mock, duplicate jobs, step logging |

### Build

- `npm run build` — all **18 routes** compile (15 dashboard pages + home redirect + API `agent/run`).
- `npm test` — **28/28 passed**.

### Manual / code review checklist

| Requirement | Method |
|-------------|--------|
| All dashboard pages load | Route inventory + static generation during build |
| Mock mode without Supabase | `localStorage` store + `NEXT_PUBLIC_MOCK_MODE` / no Supabase URL |
| Emergency stop | `agent/pipeline.test.ts` + early return in pipeline |
| Setup checklist gates autopilot | `isSetupComplete` / `canRunFullAutoApply` + pipeline early exit in live mode |
| Usage limits enforced | `canIncrement` in pipeline for jobs analyzed & applications |
| Agent logs per action | Pipeline logs: ingest, analyze, scam, trust, fit, resume, cover, truth, decision, Gemini skip |
| Blocked actions with reasons | `blocked_actions` + `reason_code` / `reason_detail` |
| Job deduplication | `idempotency_key` + duplicate skip log |
| Application deduplication | Check existing app by job idempotency key |
| Application detail audit fields | Application detail page sections |
| Resume library 15 / 5 active | `RESUME_TEMPLATE_SEEDS` + constants test |
| Cover letter library 9 | `COVER_LETTER_TEMPLATE_SEEDS` + constants test |
| Evidence / truth filter | `validateClaimsAgainstEvidence` + pipeline block on fail |
| Password manager only | `PASSWORD_STORAGE_ENABLED = false` + Settings copy |
| Sponsorship not auto-answered | `sponsorship-guard.ts` + REVIEW decision |
| $0 cost default | `DEFAULT_USAGE_LIMITS` |
| No Gemini in mock | `usesRealGeminiApi()` gate; pipeline logs skip |
| No Gmail in mock | `fetchJobAlertEmails` mock fixture only |
| GitHub Actions safe default | Workflow runs `agent:mock` unless `LIVE_AGENT_ENABLED=true` |

---

## 2. What Passed

- **Branding:** Product name is **9to5 AI** throughout (no ApplyGuard references).
- **Dashboard routes (15):** `/dashboard`, `/setup`, `/jobs`, `/applications`, `/applications/[id]`, `/companies`, `/profile`, `/resumes`, `/cover-letters`, `/evidence`, `/blocked`, `/limits`, `/agent-logs`, `/settings`, `/` → redirect.
- **Mock mode:** Works with browser local store; no Supabase required for UI or agent API run.
- **Emergency stop:** Blocks ingestion and processing; logs `actions_blocked: true`.
- **Setup checklist:** Blocks full autopilot when incomplete; mock mode treats Supabase/Gmail/GitHub items as optional for local testing.
- **Usage limits:** Jobs-analyzed cap stops pipeline; application cap downgrades AUTO_APPLY to REVIEW when exceeded.
- **Agent logging:** Each run records start, ingest, per-job steps, decision, completion.
- **Duplicates:** Second agent run skips same idempotency key (tested).
- **Libraries:** 15 resume templates (5 active), 9 cover letter templates, 10+ seeded evidence items.
- **Truth filter:** Flags unsupported skills and inflated experience patterns.
- **Sponsorship:** Jobs mentioning sponsorship → REVIEW if no saved profile/best-answer.
- **Cost:** `maxCostPerDay` and `maxCostPerMonth` default to **0**; dashboard shows **$0.00**.
- **GitHub Actions:** Default path uses `MOCK_MODE=true` and `npm run agent:mock` only.

---

## 3. What Failed (Before Fixes)

| Issue | Severity |
|-------|----------|
| Emergency stop ran but tests checked wrong store reference | Low (test only) |
| Setup checklist required Supabase even in mock — autopilot always “incomplete” locally | Medium |
| Pipeline did not skip Gemini in mock (returned mock JSON but still counted as AI call) | Medium |
| Pipeline lacked duplicate **application** check | Medium |
| Application detail missing structured company, URL, resume/CL template names | Medium |
| Agent logs too sparse (start/end only) | Medium |
| Live mode did not stop when setup incomplete | Medium |
| GitHub workflow `secrets.MOCK_MODE \|\| 'true'` invalid + always used mock script without live guard | Medium |
| Sponsorship questions not gated | Medium |
| `callGemini` still invoked in mock (local mock response, not a real API) | Low (clarified: now **not called**) |
| `DecisionInput` missing `duplicateApplication` / sponsorship fields | Low |

---

## 4. What Was Fixed

1. **`agent/pipeline.ts`** — Emergency stop; setup incomplete stops live runs; per-step logging; job + application dedupe; budget limits; sponsorship guard; Gemini only when `usesRealGeminiApi()`; Gmail mock log; richer `decision_reason` on applications.
2. **`src/lib/setup-checklist.ts`** — `mockMode` option excludes Supabase/schema/gmail/github_actions from required items.
3. **`src/lib/gemini/client.ts`** — Mock mode throws/skips real API; `usesRealGeminiApi()` helper.
4. **`src/lib/engines/sponsorship-guard.ts`** — New guard + tests.
5. **`src/lib/engines/decision.ts`** — `duplicateApplication`, `SPONSORSHIP_UNKNOWN` → REVIEW.
6. **`src/app/applications/[id]/page.tsx`** — Full audit: company, title, URL, scores, resume/CL template, decision reason.
7. **`src/app/dashboard/page.tsx`**, **`setup/page.tsx`** — Mock-aware checklist.
8. **`src/app/settings/page.tsx`** — Password storage policy display.
9. **`src/lib/constants.ts`** — `PASSWORD_STORAGE_ENABLED = false`.
10. **`.github/workflows/daily-agent.yml`** — Safe default mock job; live job only if `LIVE_AGENT_ENABLED=true`.
11. **Tests added:** `agent/pipeline.test.ts`, `constants.test.ts`, `sponsorship-guard.test.ts`, setup mock-mode case.

---

## 5. What Still Needs Human Setup

Before connecting **production** Supabase + live agent:

| Step | Action |
|------|--------|
| Supabase | Create project; run `supabase/migrations/001_initial_schema.sql`; optional `supabase/seed/prompt_versions.sql` |
| Environment | Copy `.env.example` → `.env.local` and GitHub Secrets |
| Gmail | Google Cloud project, OAuth, dedicated job-search Gmail, `GMAIL_REFRESH_TOKEN` |
| Gemini | Google AI Studio API key (or keep `MOCK_MODE=true`) |
| Deploy | Vercel/Cloudflare — set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Profile | Real name, job email, skills, target roles in dashboard |
| Evidence | Review/approve all Evidence Bank rows |
| Resumes | Paste real resume text into 15 templates; keep 5 active initially |
| Cover letters | Customize 9 templates |
| Companies | Add real watchlist + career URLs |
| GitHub Actions | Add secrets; leave `LIVE_AGENT_ENABLED` unset until ready |
| Live agent | Set `LIVE_AGENT_ENABLED=true` only when all secrets and checklist are green |

**Optional Phase 1 local use (no Supabase):** `npm run dev` → Settings: Mock mode ON, Emergency stop OFF → Agent Logs → Run agent now.

---

## 6. Is Phase 1 Ready for Supabase Connection?

**Yes — with conditions.**

| Area | Status |
|------|--------|
| Schema & RLS | Ready — migration file complete |
| Dashboard UI | Ready — works in local mock; will use Supabase once env vars set |
| Agent logic | Ready — pipeline tested in mock; wire service-role client in Phase 3 follow-up for CI → Supabase persistence |
| Auth | Not wired in Phase 1 UI (single-user local store); add Supabase Auth when connecting |
| Persistence | Agent API returns updated `store` JSON to browser; **GitHub Actions → Supabase writes** need `AGENT_USER_ID` + service role (documented, not blocking schema connection) |

**Recommendation:** Connect Supabase next by:

1. Running migration SQL.
2. Setting env vars and redeploying.
3. Replacing or syncing `useLocalStore` with Supabase reads/writes (incremental).
4. Keeping `MOCK_MODE=true` until checklist is green, then enabling live agent secrets.

---

## Summary

Phase 1 verification **passed** after fixes. The product is **9to5 AI**, builds cleanly, has **28 automated tests**, and meets the reviewed safety defaults (mock-first, $0 cost, emergency stop, truth/sponsorship guards, no duplicate jobs/apps in the agent). **Ready for Supabase connection** from a schema and dashboard perspective; live Gmail/Gemini/automation remain human-configured.
