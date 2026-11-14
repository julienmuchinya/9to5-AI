import type { GeminiTool } from "@/lib/v2/gemini";
import { COMPANY_DAILY_CAP, MAX_DAILY_APPLY_CAP, MAX_POSTING_AGE_DAYS } from "@/lib/v2/priority";

/** Sites the agent submits to by itself (one shared check: verify.ts). */
export const AUTO_SITES = "Greenhouse, Lever, Ashby, Workday, Workable, Rippling, JazzHR and Jobvite";

export const TOOLS: GeminiTool[] = [
  {
    name: "get_status",
    description: "Current agent status: matched jobs, applications by status, autopilot settings, last run, whether a run is going on now, free-tier usage.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "explain_last_run",
    description:
      "Why few applications went through: what the last finished run did and what blocked it (time budget, GitHub minutes, CAPTCHAs, sites cooling down, per-company cap, Workday sign-ins, questions waiting on the user). Call this when the user asks why applications are low.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "search_jobs",
    description: "Search the user's matched jobs, freshest and best-fitting first. Returns id, title, company, fit score, when posted, verification, location, pay.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to find in the title or company, e.g. 'backend', 'data', 'Stripe'" },
        level: { type: "string", enum: ["internship", "new_grad", "entry", "mid", "senior"] },
        min_fit: { type: "integer" },
        verified_only: { type: "boolean" },
        auto_submit_only: { type: "boolean", description: `Only jobs on sites the agent can submit to itself (${AUTO_SITES})` },
        not_applied_only: { type: "boolean", description: "Leave out jobs that already have an application" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "queue_applications",
    description: `Queue applications for the agent to submit on its next run (freshest postings go first, max ${COMPANY_DAILY_CAP} per company per day). Pass job_ids from search_jobs, a query (title or company words) to queue every matching verified job, or all_matches=true to queue EVERY verified match the agent can submit (up to 500).`,
    parameters: {
      type: "object",
      properties: {
        job_ids: { type: "array", items: { type: "string" } },
        query: { type: "string" },
        all_matches: { type: "boolean", description: "Queue every verified match the agent can submit (\"apply to all my matches\")" },
        level: { type: "string", enum: ["internship", "new_grad", "entry", "mid", "senior"] },
        min_fit: { type: "integer" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "list_applications",
    description:
      "The user's applications, newest first, filtered by status. 'needs_user' rows include why the agent stopped and any questions waiting for an answer. Use it before retrying, answering, marking or explaining.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["queued", "needs_user", "failed", "submitted", "received", "under_review", "screening", "interview", "offer", "rejected", "withdrawn", "closed", "all"] },
        company: { type: "string", description: "Only this company (partial name is fine)" },
        field: { type: "string", description: "Only one field or industry, e.g. 'oil and gas', 'minerals', 'healthcare', 'finance', 'tech' — matched by job title and employer. Use this for 'how many … in the X sector' questions." },
        limit: { type: "integer", description: "Default 10, max 40" },
      },
    },
  },
  {
    name: "retry_applications",
    description: "Put applications back in the queue so the agent tries them again on its next run. Pass ids from list_applications, a company name, or all_of a status ('needs_user', 'failed', 'closed').",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        company: { type: "string" },
        all_of: { type: "string", enum: ["needs_user", "failed", "closed"] },
      },
    },
  },
  {
    name: "answer_question",
    description:
      "Save the user's answer to an application question the agent couldn't answer (from list_applications status needs_user). The answer is remembered for every form that asks it, and the waiting applications go back in the queue.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question text exactly as listed" },
        answer: { type: "string" },
      },
      required: ["question", "answer"],
    },
  },
  {
    name: "update_applications",
    description: "Change applications the user handled themselves: mark as applied (they submitted it), interview, offer, rejected, withdrawn, or delete. Pass ids from list_applications or a company name.",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        company: { type: "string" },
        action: { type: "string", enum: ["applied", "interview", "offer", "rejected", "withdrawn", "delete"] },
      },
      required: ["action"],
    },
  },
  {
    name: "dismiss_jobs",
    description: "Hide matched jobs the user isn't interested in (ids from search_jobs, or a query such as a company name) so the agent never applies to them.",
    parameters: {
      type: "object",
      properties: { job_ids: { type: "array", items: { type: "string" } }, query: { type: "string" } },
    },
  },
  {
    name: "job_match_report",
    description:
      "How well the user's resume matches one job: the technologies the posting names, which ones the resume has and lacks, the fit reasons, and whether the agent would send the original resume (≥80% coverage) or a tailored one. Pass a job id from search_jobs, or a query (title / company).",
    parameters: { type: "object", properties: { job_id: { type: "string" }, query: { type: "string" } } },
  },
  {
    name: "follow_ups",
    description: "Applications that went quiet: submitted or received more than N days ago (default 10) with no reply since. Returns company, title, days waiting, link, and a short follow-up note the user can send.",
    parameters: { type: "object", properties: { days: { type: "integer" }, limit: { type: "integer" } } },
  },
  {
    name: "update_preferences",
    description: "Change what jobs the agent looks for.",
    parameters: {
      type: "object",
      properties: {
        add_target_roles: { type: "array", items: { type: "string" } },
        remove_target_roles: { type: "array", items: { type: "string" } },
        job_levels: { type: "array", items: { type: "string", enum: ["internship", "new_grad", "entry", "mid", "senior"] } },
        min_salary: { type: "integer", description: "Minimum yearly pay in USD for full-time roles" },
        locations: { type: "array", items: { type: "string", enum: ["remote_us", "GA", "anywhere_us"] } },
        relocation: { type: "boolean" },
        add_keywords_include: { type: "array", items: { type: "string" } },
        add_keywords_exclude: { type: "array", items: { type: "string" } },
        add_excluded_companies: { type: "array", items: { type: "string" } },
        add_skills: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "set_autopilot",
    description: "Turn automatic submission on/off, pause or resume the agent, or change the daily cap / minimum fit score.",
    parameters: {
      type: "object",
      properties: {
        auto_submit_enabled: { type: "boolean" },
        paused: { type: "boolean" },
        daily_apply_cap: { type: "integer", description: `0-${MAX_DAILY_APPLY_CAP} applications per day (the free AI quota is the real limit)` },
        min_fit_score: { type: "integer", description: "40-95" },
      },
    },
  },
  {
    name: "get_profile",
    description: "What the agent knows about the user: resume summary, skills, experience, education, job preferences, and what's missing.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "run_agent_now",
    description:
      "Start an agent run right away instead of waiting for the schedule: it searches for new postings, then applies to the queue and the freshest matches. When the user names a kind of job to go after (\"go apply to oil field jobs\", \"look for offshore roles\"), pass focus_roles: those become the focus (applied to before anything else, any US location) and are added to their target roles.",
    parameters: {
      type: "object",
      properties: {
        focus_roles: {
          type: "array",
          items: { type: "string" },
          description:
            "Concrete job titles plus the industry, 2-8 items. E.g. oil & gas / offshore → [\"Roustabout\", \"Floorhand\", \"Field Operator\", \"Lease Operator\", \"Pipeline Operator\", \"Petroleum Engineer\", \"oil and gas\", \"offshore\"]",
        },
      },
    },
  },
  {
    name: "set_focus",
    description: "Make some roles the agent's focus without starting a run (or clear the focus with an empty list). Focus roles go first on every run and are added to target roles.",
    parameters: { type: "object", properties: { focus_roles: { type: "array", items: { type: "string" } } }, required: ["focus_roles"] },
  },
];

export const SYSTEM_BASE = `You are 9to5 AI, a friendly job-search agent working for the signed-in user.
You find real jobs in ANY field (tech, healthcare, trades, energy, finance, sales, retail, admin…) that match their resume and target roles, verify employers, and submit applications for them.
You can also help with career questions: resume tips, interview prep, what roles fit them, salary ranges, how the app works.

How to behave:
- Be helpful. Don't refuse normal requests. If something isn't possible yet, say exactly why and what the user can do (e.g. "upload your resume on Resume & profile").
- Use tools to act or look things up; never claim you did something unless a tool result confirms it.
- When asked about their resume, skills or preferences, call get_profile first.
- When asked about jobs or applications, call search_jobs, list_applications or get_status. If there are 0 matched jobs, explain the agent searches every 2 hours, and offer run_agent_now.
- "Look for new jobs" / "search for jobs" / "start applying" = run_agent_now (one run both searches and applies).
- When the user names a KIND of job to go after ("go apply to oil field jobs", "look for offshore / natural gas / mining jobs"), call run_agent_now WITH focus_roles (concrete titles + the industry words). That job becomes the priority over everything else and is added to their target roles; say so. Then also call search_jobs with one of the titles: if matches exist, queue_applications them.
- "Apply to <one company or a job you listed>" = search_jobs then queue_applications, then run_agent_now.
- Retry / answer / mark / dismiss: call list_applications or search_jobs first so you act on the right rows, then the change tool, then say exactly what changed (counts, company names).
- When the user answers a question the agent was waiting on (from needs_user rows), call answer_question with the question text as listed.
- ONLY act on the user's LATEST message. Earlier messages are context: never repeat a change, queue or run from an earlier message (e.g. an old "cap of 20") unless the latest message asks for it again. A one-word message like "answer" or "why?" is a question — look things up, don't change settings.
- The agent auto-submits verified jobs on ${AUTO_SITES}. Jobs on other sites (SmartRecruiters, iCIMS, Taleo, company sites) show "Apply yourself" on the Jobs page; SmartRecruiters blocks automated browsers with a CAPTCHA.
- "Apply to all my matches" / "submit everything" = queue_applications with all_matches=true, then run_agent_now.
- To look for a new kind of job in any field, add it with update_preferences add_target_roles (any job title works) — or run_agent_now with focus_roles to make it the priority.
- AI: Gemini first; when Gemini's daily quota is used, the agent and this chat switch to Groq automatically, so a Gemini limit does not stop applications.
- "How well do I match X" / "what am I missing for X" → job_match_report. "Who should I follow up with" / "which applications went quiet" → follow_ups (give the note so they can copy it).
- When asked why few applications are sent, call explain_last_run and answer from its numbers: the usual causes are the run's time budget / GitHub minutes, CAPTCHAs on Lever/Ashby, sites cooling down after a CAPTCHA, the per-company daily cap, Workday sign-ins, and questions waiting in "Needs you".
- The agent also searches oil & gas, offshore drilling, pipeline, refinery and mining employers' Workday sites (Transocean, Noble, Chevron, Shell, ConocoPhillips, Baker Hughes, Marathon Petroleum, ONEOK, Williams…) for the focus roles.
- The agent applies to the freshest postings first (last 24h, then 2-3 days, then this week), skips postings older than ${MAX_POSTING_AGE_DAYS} days, and sends at most ${COMPANY_DAILY_CAP} applications per company per day.
- Answers to common application questions (visa, EEO, start date, salary…) come from Resume & profile → Common questions; suggest filling those when applications land in "Needs you".
- Never invent facts about the user, their experience or a job. Keep replies short and concrete (counts, company names). Use plain text, short lists are fine.`;

/** Tool results fed back to the AI: long lists cut down so each round stays small (fewer per-minute limits). */
export function compact(result: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(result);
  if (json.length <= 6000) return result;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) out[k] = Array.isArray(v) ? [...v.slice(0, 12), ...(v.length > 12 ? [`…and ${v.length - 12} more`] : [])] : v;
  return JSON.stringify(out).length <= 9000 ? out : { ...out, note: "Shortened — ask for fewer rows for details" };
}

/** A plain answer built from tool results, for when the AI can't finish in time. */
export function summarizeActions(actions: { tool: string; result: Record<string, unknown> }[]): string {
  const lines: string[] = [];
  for (const { tool, result } of actions) {
    if (result.error) continue;
    const label = (k: string) => k.replace(/_/g, " ");
    const nums = Object.entries(result).flatMap(([k, v]) => {
      if (typeof v === "number") return [`${label(k)}: ${v}`];
      // Counts one level down, e.g. applications: { submitted: 265, received: 85 } or by_status.
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const inner = Object.entries(v as Record<string, unknown>).filter(([, n]) => typeof n === "number");
        if (inner.length) return [`${label(k)} — ${inner.map(([ik, n]) => `${label(ik)} ${n}`).join(", ")}`];
      }
      return [];
    });
    const list = Object.values(result).find((v) => Array.isArray(v)) as unknown[] | undefined;
    const names = (list ?? []).slice(0, 8).map((x) => (typeof x === "string" ? x : [((x as Record<string, unknown>).title ?? ""), ((x as Record<string, unknown>).company ?? "")].filter(Boolean).join(" — "))).filter(Boolean);
    const what = tool.replace(/_/g, " ");
    if (result.started === true) lines.push("Started an agent run — it searches for new postings, then applies.");
    else if (nums.length || names.length) lines.push(`${what}: ${nums.join(", ")}${names.length ? `${nums.length ? " — " : ""}${names.join("; ")}` : ""}`);
    else if (result.note) lines.push(`${what}: ${String(result.note)}`);
  }
  return lines.length
    ? `The AI got slow, so here's what I found directly:\n- ${lines.join("\n- ")}`
    : "The AI is busy right now (free-tier limits). Please try again in a minute — nothing was changed.";
}
