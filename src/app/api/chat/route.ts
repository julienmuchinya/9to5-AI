import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiUser, serviceClient } from "@/lib/v2/session";
import { changeNotAsked } from "@/lib/v2/chat-guard";
import { chatGenerate, FreeTierLimitError, type GeminiContent, type GeminiTool } from "@/lib/v2/gemini";
import { freeTierSnapshot } from "@/lib/v2/freeTier";
import { logEvent } from "@/lib/v2/log";
import { dispatchAgentRun, machineStatus } from "@/lib/v2/dispatch";
import { ago, COMPANY_DAILY_CAP, freshness, MAX_DAILY_APPLY_CAP, MAX_POSTING_AGE_DAYS, priorityScore } from "@/lib/v2/priority";
import { needsKind, NEEDS_LABEL } from "@/lib/v2/needs";
import { customStore, findSimilarAnswer, memoryKey, type CustomAnswers, type PendingQuestion } from "@/lib/v2/app-questions";
import { jobSkillCoverage } from "@/lib/v2/resume-library";
import { expectedChanges, expectedLookups } from "./intent";
import type { ParsedResume } from "@/lib/v2/resume";

export const maxDuration = 60;

/** Sites the agent submits to by itself. */
const AUTO_ATS = ["greenhouse", "lever", "ashby", "workday", "workable"];

const TOOLS: GeminiTool[] = [
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
        auto_submit_only: { type: "boolean", description: "Only jobs on sites the agent can submit to itself (Greenhouse, Lever, Ashby, Workday, Workable)" },
        not_applied_only: { type: "boolean", description: "Leave out jobs that already have an application" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "queue_applications",
    description: `Queue applications for the agent to submit on its next run (freshest postings go first, max ${COMPANY_DAILY_CAP} per company per day). Pass job_ids from search_jobs, or a query (title or company words) to queue every matching verified job. Max 50 at once.`,
    parameters: {
      type: "object",
      properties: {
        job_ids: { type: "array", items: { type: "string" } },
        query: { type: "string" },
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
        daily_apply_cap: { type: "integer", description: "0-300 applications per day (free AI quota and GitHub minutes are the real limits)" },
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
    description: "Start an agent run right away instead of waiting for the schedule: it searches for new postings, then applies to the queue and the freshest matches.",
    parameters: { type: "object", properties: {} },
  },
];

const SYSTEM_BASE = `You are 9to5 AI, a friendly job-search agent working for the signed-in user.
You find real STEM jobs that match their resume, verify employers, and submit applications for them.
You can also help with career questions: resume tips, interview prep, what roles fit them, salary ranges, how the app works.

How to behave:
- Be helpful. Don't refuse normal requests. If something isn't possible yet, say exactly why and what the user can do (e.g. "upload your resume on Resume & profile").
- Use tools to act or look things up; never claim you did something unless a tool result confirms it.
- When asked about their resume, skills or preferences, call get_profile first.
- When asked about jobs or applications, call search_jobs, list_applications or get_status. If there are 0 matched jobs, explain the agent searches every 3 hours, and offer run_agent_now.
- "Look for new jobs" / "search for jobs" / "start applying" = run_agent_now (one run both searches and applies). "Apply to X" = search_jobs then queue_applications, then offer run_agent_now so it goes out now instead of on the schedule.
- Retry / answer / mark / dismiss: call list_applications or search_jobs first so you act on the right rows, then the change tool, then say exactly what changed (counts, company names).
- When the user answers a question the agent was waiting on (from needs_user rows), call answer_question with the question text as listed.
- ONLY act on the user's LATEST message. Earlier messages are context: never repeat a change, queue or run from an earlier message (e.g. an old "cap of 20") unless the latest message asks for it again. A one-word message like "answer" or "why?" is a question — look things up, don't change settings.
- The agent auto-submits verified jobs on Greenhouse, Lever, Ashby, Workday and Workable. SmartRecruiters and most other sites go to "Needs you" (SmartRecruiters blocks automated browsers with a CAPTCHA).
- AI: Gemini first; when Gemini's daily quota is used, the agent and this chat switch to Groq automatically, so a Gemini limit does not stop applications.
- "How well do I match X" / "what am I missing for X" → job_match_report. "Who should I follow up with" / "which applications went quiet" → follow_ups (give the note so they can copy it).
- When asked why few applications are sent, call explain_last_run and answer from its numbers: the usual causes are the run's time budget / GitHub minutes, CAPTCHAs on Lever/Ashby, sites cooling down after a CAPTCHA, the per-company daily cap, Workday sign-ins, and questions waiting in "Needs you".
- The agent applies to the freshest postings first (last 24h, then 2-3 days, then this week), skips postings older than ${MAX_POSTING_AGE_DAYS} days, and sends at most ${COMPANY_DAILY_CAP} applications per company per day.
- Answers to common application questions (visa, EEO, start date, salary…) come from Resume & profile → Common questions; suggest filling those when applications land in "Needs you".
- Never invent facts about the user, their experience or a job. Keep replies short and concrete (counts, company names). Use plain text, short lists are fine.`;

async function systemFor(sb: SupabaseClient, userId: string): Promise<string> {
  const [{ data: p }, { count }] = await Promise.all([
    sb.from("profiles").select("first_name,resume_path,resume_parsed,phone,work_authorized_us,sponsorship_needed,target_roles").eq("id", userId).maybeSingle(),
    sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("dismissed", false),
  ]);
  const parsed = Boolean(p?.resume_parsed && Object.keys(p.resume_parsed as object).length);
  return `${SYSTEM_BASE}

Right now: name=${p?.first_name ?? "unknown"}; resume uploaded=${Boolean(p?.resume_path)}; resume read by AI=${parsed}; matched jobs=${count ?? 0}; target roles=${(p?.target_roles ?? []).join(", ") || "none yet"}; phone set=${Boolean(p?.phone)}; work authorization answered=${p?.work_authorized_us != null}; sponsorship answered=${p?.sponsorship_needed != null}. Today is ${new Date().toDateString()}.`;
}

/** Earlier failures ("Something went wrong…") must not be fed back to the model — they make it refuse. */
const FAILURE = /^(Something went wrong|I've paused AI chat|AI is busy|Sorry, I couldn't)/;


/** Safe inside a PostgREST `or(...)` filter: no separators, wildcards, quotes or escapes from user text. */
const clean = (s: string) => s.replace(/[,()%*"'\\:.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const uuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

type Args = Record<string, unknown>;

type AppRow = { id: string; status: string; error: string | null; pending_questions: PendingQuestion[] | null; created_at: string; status_updated_at: string | null; submitted_at: string | null; apply_url: string | null; ats: string | null; jobs: { title: string; company_name: string } | null };
const APP_COLS = "id,status,error,pending_questions,created_at,status_updated_at,submitted_at,apply_url,ats,jobs(title,company_name)";

/** Applications picked by ids and/or a company name (the chat never changes rows it didn't name). */
async function pickApplications(sb: SupabaseClient, userId: string, args: Args, statuses?: string[]): Promise<AppRow[]> {
  let q = sb.from("applications").select(APP_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  const ids = Array.isArray(args.ids) ? (args.ids as unknown[]).filter(uuid) : [];
  if (ids.length) q = q.in("id", ids as string[]);
  if (statuses?.length) q = q.in("status", statuses);
  const { data } = await q;
  let rows = (data ?? []) as unknown as AppRow[];
  const company = args.company ? clean(String(args.company)).toLowerCase() : "";
  if (company) rows = rows.filter((r) => (r.jobs?.company_name ?? "").toLowerCase().includes(company));
  if (!ids.length && !company && !args.all_of && !args.query) return [];
  return rows;
}

async function runTool(name: string, args: Args, sb: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
  switch (name) {
    case "get_status": {
      const [{ count: matched }, apps, { data: settings }, { data: run }, machine] = await Promise.all([
        sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("dismissed", false),
        sb.from("applications").select("status").eq("user_id", userId),
        sb.from("autopilot_settings").select("auto_submit_enabled,paused,daily_apply_cap,min_fit_score").eq("user_id", userId).single(),
        sb.from("agent_runs").select("started_at,status,summary").eq("user_id", userId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
        machineStatus(),
      ]);
      const byStatus: Record<string, number> = {};
      for (const a of apps.data ?? []) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      const free = await freeTierSnapshot(serviceClient());
      return {
        matched_jobs: matched ?? 0,
        applications: byStatus,
        autopilot: settings,
        last_run: run,
        agent_right_now: machine.state === "idle" ? "idle" : `${machine.state} since ${machine.since}`,
        next_scheduled_run: machine.nextScheduled,
        gemini_today: `${free.gemini.used}/${free.gemini.limit}${free.gemini.allowed ? "" : " (used up; the agent uses Groq instead, so applying continues)"}`,
      };
    }
    case "explain_last_run": {
      const [{ data: runs }, { data: waiting }, { data: cool }] = await Promise.all([
        sb.from("agent_runs").select("started_at,ended_at,status,summary").eq("user_id", userId).order("started_at", { ascending: false }).limit(8),
        sb.from("applications").select("error,pending_questions").eq("user_id", userId).eq("status", "needs_user"),
        serviceClient().from("site_cooldowns").select("host,reason,until").gt("until", new Date().toISOString()),
      ]);
      const done = (runs ?? []).filter((r) => r.status !== "running");
      const last = done.find((r) => Object.keys((r.summary as { applications?: object })?.applications ?? {}).length) ?? done[0];
      const kinds: Record<string, number> = {};
      for (const w of waiting ?? []) {
        const k = NEEDS_LABEL[needsKind(w.error, (w.pending_questions as unknown[] | null)?.length ?? 0)].label;
        kinds[k] = (kinds[k] ?? 0) + 1;
      }
      const a = ((last?.summary as { applications?: Record<string, number> })?.applications ?? {}) as Record<string, number>;
      const minutes = last?.ended_at && last?.started_at ? Math.round((Date.parse(last.ended_at) - Date.parse(last.started_at)) / 60000) : null;
      const explain: string[] = [];
      if (a.time_budget) explain.push("The run used its whole time budget and left the rest of the queue for the next run (each run gets ~25–40 minutes of GitHub time; a private repo has ~57 free minutes a day, so most scheduled runs are skipped).");
      if (a.cooling_down) explain.push(`${a.cooling_down} jobs skipped because their site showed a CAPTCHA earlier and is cooling down for 24h.`);
      if (a.company_daily_cap) explain.push(`${a.company_daily_cap} jobs held for a later day: already ${COMPANY_DAILY_CAP} applications to that company today.`);
      if (a.needs_user) explain.push(`${a.needs_user} applications went to "Needs you" (CAPTCHA at submit, a question the agent couldn't answer, or no confirmation seen).`);
      if (a.failed) explain.push(`${a.failed} failed and will be retried (mostly Workday sign-in / verification emails and required questions).`);
      const skippedRuns = done.filter((r) => !Object.keys((r.summary as { applications?: object })?.applications ?? {}).length).length;
      return {
        last_run: last ? { started_at: last.started_at, minutes, status: last.status, ...a } : null,
        runs_skipped_recently: skippedRuns ? `${skippedRuns} of the last ${done.length} runs did nothing (usually: the day's GitHub minutes were used up)` : null,
        needs_you_by_kind: kinds,
        sites_cooling_down: (cool ?? []).length,
        explanation: explain,
        what_helps: [
          "Make the GitHub repo public (unlimited free Actions minutes) or run the agent on your own PC — minutes are the biggest limit.",
          "Answer the questions in Needs you (or here in chat) — they're reused on every form.",
          "Finish CAPTCHA applications yourself: the form is already filled, only the human check and Submit are left.",
        ],
      };
    }
    case "search_jobs":
    case "queue_applications":
    case "dismiss_jobs": {
      const limit = Math.max(1, Math.min(name === "search_jobs" ? 25 : 50, Number(args.limit ?? (name === "search_jobs" ? 10 : 20))));
      let q = sb
        .from("jobs")
        .select("id,title,company_name,fit_score,posting_id,url, job_postings!inner(level,locations,is_remote,ats,verification_status,salary_max,posted_at)")
        .eq("user_id", userId)
        .eq("dismissed", false)
        .order("fit_score", { ascending: false })
        .limit(Math.min(300, limit * 4));
      const ids = Array.isArray(args.job_ids) ? (args.job_ids as unknown[]).filter(uuid) : [];
      if (ids.length) q = q.in("id", ids as string[]);
      if (args.query) {
        const t = clean(String(args.query));
        if (t) q = q.or(`title.ilike.%${t}%,company_name.ilike.%${t}%`);
      }
      if (name === "dismiss_jobs" && !ids.length && !args.query) return { error: "Say which jobs to dismiss (ids from search_jobs, or a company / title to match)" };
      if (args.level) q = q.eq("job_postings.level", String(args.level));
      if (args.min_fit) q = q.gte("fit_score", Number(args.min_fit));
      if (args.verified_only || name === "queue_applications") q = q.eq("job_postings.verification_status", "verified");
      if (args.auto_submit_only) q = q.in("job_postings.ats", AUTO_ATS);
      const { data, error } = await q;
      if (error) return { error: error.message };
      type Row = { id: string; title: string; company_name: string; fit_score: number; posting_id: string; url: string; job_postings: { level: string; locations: string[]; is_remote: boolean; ats: string; verification_status: string; salary_max: number | null; posted_at: string | null } };
      let all = (data ?? []) as unknown as Row[];
      const { data: existing } = await sb.from("applications").select("job_id,status").eq("user_id", userId).in("job_id", all.map((r) => r.id));
      const applied = new Map((existing ?? []).map((e) => [e.job_id as string, e.status as string]));
      if (args.not_applied_only || name === "queue_applications") all = all.filter((r) => !applied.has(r.id));
      // Freshest + best-fitting first: new postings get many more replies.
      const rows = all.sort((a, b) => priorityScore(b.fit_score, b.job_postings.posted_at) - priorityScore(a.fit_score, a.job_postings.posted_at)).slice(0, limit);
      if (name === "search_jobs")
        return {
          jobs: rows.map((r) => ({
            id: r.id,
            title: r.title,
            company: r.company_name,
            fit: r.fit_score,
            posted: ago(r.job_postings.posted_at) ?? "unknown",
            freshness: freshness(r.job_postings.posted_at).label,
            level: r.job_postings.level,
            location: r.job_postings.is_remote ? "Remote" : r.job_postings.locations.slice(0, 2).join("; "),
            pay_up_to: r.job_postings.salary_max,
            verification: r.job_postings.verification_status,
            agent_can_submit: AUTO_ATS.includes(r.job_postings.ats),
            application: applied.get(r.id) ?? null,
          })),
        };
      if (name === "dismiss_jobs") {
        if (!rows.length) return { dismissed: 0 };
        const { error: dErr } = await sb.from("jobs").update({ dismissed: true }).in("id", rows.map((r) => r.id)).eq("user_id", userId);
        return dErr ? { error: dErr.message } : { dismissed: rows.length, jobs: rows.map((r) => `${r.title} — ${r.company_name}`) };
      }
      if (!rows.length) return { queued: 0, note: "No verified matching jobs without an application yet" };
      const { error: upErr } = await sb.from("applications").upsert(
        rows.map((r) => ({ user_id: userId, job_id: r.id, posting_id: r.posting_id, apply_url: r.url, ats: r.job_postings.ats, status: "queued", requested_by: "chat" })),
        { onConflict: "user_id,job_id", ignoreDuplicates: true }
      );
      if (upErr) return { error: upErr.message };
      return { queued: rows.length, jobs: rows.map((r) => `${r.title} — ${r.company_name}`), note: "They go out on the next run; offer run_agent_now to send them now." };
    }
    case "list_applications": {
      const limit = Math.max(1, Math.min(40, Number(args.limit ?? 10)));
      let q = sb.from("applications").select(APP_COLS).eq("user_id", userId).order("status_updated_at", { ascending: false, nullsFirst: false }).limit(300);
      const status = String(args.status ?? "all");
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return { error: error.message };
      let rows = (data ?? []) as unknown as AppRow[];
      const company = args.company ? clean(String(args.company)).toLowerCase() : "";
      if (company) rows = rows.filter((r) => (r.jobs?.company_name ?? "").toLowerCase().includes(company));
      return {
        total: rows.length,
        applications: rows.slice(0, limit).map((r) => ({
          id: r.id,
          company: r.jobs?.company_name,
          title: r.jobs?.title,
          status: r.status,
          site: r.ats,
          submitted: r.submitted_at ? ago(r.submitted_at) : null,
          last_change: ago(r.status_updated_at ?? r.created_at),
          why: r.status === "needs_user" || r.status === "failed" || r.status === "queued" ? r.error?.slice(0, 200) ?? null : undefined,
          kind: r.status === "needs_user" ? NEEDS_LABEL[needsKind(r.error, r.pending_questions?.length ?? 0)].label : undefined,
          questions_waiting: r.pending_questions?.map((p) => ({ question: p.label, options: p.options?.slice(0, 12) })) ?? undefined,
          link: r.apply_url,
        })),
      };
    }
    case "retry_applications": {
      const allOf = args.all_of ? [String(args.all_of)] : ["needs_user", "failed", "closed"];
      const rows = await pickApplications(sb, userId, args, allOf);
      if (!rows.length) return { requeued: 0, note: "Nothing matched — give ids from list_applications, a company, or all_of" };
      const { error } = await sb
        .from("applications")
        .update({ status: "queued", error: "Retry asked for in chat — reapplying on the next run", attempts: 0, pending_questions: null, status_updated_at: new Date().toISOString() })
        .in("id", rows.map((r) => r.id))
        .eq("user_id", userId);
      return error ? { error: error.message } : { requeued: rows.length, applications: rows.map((r) => `${r.jobs?.title} — ${r.jobs?.company_name}`) };
    }
    case "answer_question": {
      const question = String(args.question ?? "").trim().slice(0, 300);
      const answer = String(args.answer ?? "").trim().slice(0, 2000);
      if (!question || !answer) return { error: "Need both the question and the answer" };
      const { data: p } = await sb.from("profiles").select("custom_answers").eq("id", userId).maybeSingle();
      const custom: CustomAnswers = { ...((p?.custom_answers ?? {}) as CustomAnswers) };
      custom[memoryKey(question)] = { q: question, a: answer, at: new Date().toISOString() };
      const { error } = await sb.from("profiles").update({ custom_answers: custom }).eq("id", userId);
      if (error) return { error: error.message };
      // Re-queue every waiting application whose questions are now all answered.
      const store = customStore(custom);
      const { data: waiting } = await sb.from("applications").select("id,pending_questions,jobs(company_name)").eq("user_id", userId).eq("status", "needs_user").not("pending_questions", "is", null);
      const ready = ((waiting ?? []) as unknown as { id: string; pending_questions: PendingQuestion[] | null; jobs: { company_name: string } | null }[]).filter((w) => {
        const qs = w.pending_questions ?? [];
        return qs.length > 0 && qs.every((q) => findSimilarAnswer(q.label, q.options ?? [], store));
      });
      if (ready.length)
        await sb
          .from("applications")
          .update({ status: "queued", error: "Your answers are saved — reapplying on the next run", attempts: 0, pending_questions: null, status_updated_at: new Date().toISOString() })
          .in("id", ready.map((w) => w.id))
          .eq("user_id", userId);
      return { saved: true, requeued: ready.length, companies: ready.map((w) => w.jobs?.company_name).filter(Boolean) };
    }
    case "update_applications": {
      const action = String(args.action ?? "");
      const rows = await pickApplications(sb, userId, args);
      if (!rows.length) return { updated: 0, note: "Nothing matched — give ids from list_applications or a company name" };
      const ids = rows.map((r) => r.id);
      const now = new Date().toISOString();
      let error: { message: string } | null = null;
      if (action === "delete") ({ error } = await sb.from("applications").delete().in("id", ids).eq("user_id", userId));
      else if (action === "applied") {
        ({ error } = await sb.from("applications").update({ status: "submitted", submitted_at: now, status_updated_at: now, error: null, pending_questions: null, requested_by: "user" }).in("id", ids).eq("user_id", userId));
        if (!error) await sb.from("application_events").insert(ids.map((id) => ({ user_id: userId, application_id: id, kind: "submitted", source: "user", detail: "Marked as applied in chat" })));
      } else if (["interview", "offer", "rejected", "withdrawn"].includes(action)) {
        ({ error } = await sb.from("applications").update({ status: action, status_updated_at: now, pending_questions: null }).in("id", ids).eq("user_id", userId));
        if (!error) await sb.from("application_events").insert(ids.map((id) => ({ user_id: userId, application_id: id, kind: action, source: "user", detail: "Updated in chat" })));
      } else return { error: `Unknown action ${action}` };
      return error ? { error: error.message } : { updated: rows.length, action, applications: rows.map((r) => `${r.jobs?.title} — ${r.jobs?.company_name}`) };
    }
    case "job_match_report": {
      let q = sb.from("jobs").select("id,title,company_name,fit_score,fit_reasons,url, job_postings!inner(description,ats,posted_at,salary_max,locations,is_remote)").eq("user_id", userId).order("fit_score", { ascending: false }).limit(5);
      if (uuid(args.job_id)) q = q.eq("id", String(args.job_id));
      else if (args.query) {
        const t = clean(String(args.query));
        if (t) q = q.or(`title.ilike.%${t}%,company_name.ilike.%${t}%`);
      } else return { error: "Which job? Give a job id from search_jobs or a title / company" };
      const [{ data: jobs }, { data: prof }] = await Promise.all([q, sb.from("profiles").select("resume_parsed").eq("id", userId).maybeSingle()]);
      type J = { id: string; title: string; company_name: string; fit_score: number; fit_reasons: string[] | null; url: string; job_postings: { description: string | null; ats: string; posted_at: string | null; salary_max: number | null; locations: string[]; is_remote: boolean } };
      const j = (jobs ?? [])[0] as unknown as J | undefined;
      if (!j) return { error: "No matched job like that" };
      const parsed = (prof?.resume_parsed ?? null) as ParsedResume | null;
      const cover = jobSkillCoverage(parsed, `${j.title}\n${j.job_postings.description ?? ""}`);
      return {
        job: { id: j.id, title: j.title, company: j.company_name, fit: j.fit_score, posted: ago(j.job_postings.posted_at), pay_up_to: j.job_postings.salary_max, location: j.job_postings.is_remote ? "Remote" : j.job_postings.locations.slice(0, 2).join("; "), link: j.url, agent_can_submit: AUTO_ATS.includes(j.job_postings.ats) },
        fit_reasons: j.fit_reasons ?? [],
        technologies_the_job_names: cover.asked,
        on_your_resume: cover.asked.filter((t) => !cover.missing.includes(t)),
        missing_from_your_resume: cover.missing,
        coverage_percent: Math.round(cover.coverage * 100),
        resume_the_agent_sends: cover.coverage >= 0.8 ? "your original PDF, untouched (strong match)" : cover.coverage >= 0.7 ? "a lightly tailored copy (reordered, keywords in bold)" : "a tailored copy (AI rewords bullets toward this job; nothing invented)",
        other_matches: (jobs ?? []).slice(1, 5).map((x) => ({ id: (x as unknown as J).id, title: (x as unknown as J).title, company: (x as unknown as J).company_name })),
      };
    }
    case "follow_ups": {
      const days = Math.max(3, Math.min(60, Number(args.days ?? 10)));
      const limit = Math.max(1, Math.min(40, Number(args.limit ?? 15)));
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await sb
        .from("applications")
        .select("id,status,submitted_at,status_updated_at,last_email_at,apply_url,jobs(title,company_name)")
        .eq("user_id", userId)
        .in("status", ["submitted", "received"])
        .lte("submitted_at", cutoff)
        .order("submitted_at", { ascending: true })
        .limit(200);
      type R = { id: string; status: string; submitted_at: string; status_updated_at: string | null; last_email_at: string | null; apply_url: string | null; jobs: { title: string; company_name: string } | null };
      const rows = ((data ?? []) as unknown as R[]).filter((r) => !r.last_email_at || r.last_email_at <= cutoff);
      const { data: prof } = await sb.from("profiles").select("first_name,last_name").eq("id", userId).maybeSingle();
      const name = [prof?.first_name, prof?.last_name].filter(Boolean).join(" ");
      return {
        quiet_for_days: days,
        total: rows.length,
        applications: rows.slice(0, limit).map((r) => ({
          id: r.id,
          company: r.jobs?.company_name,
          title: r.jobs?.title,
          status: r.status,
          days_waiting: Math.round((Date.now() - Date.parse(r.submitted_at)) / 86400_000),
          link: r.apply_url,
          follow_up_note: `Hi — I applied for the ${r.jobs?.title ?? "role"} position at ${r.jobs?.company_name ?? "your company"} about ${Math.round((Date.now() - Date.parse(r.submitted_at)) / 86400_000)} days ago and wanted to check in. I'm still very interested and happy to share anything that would help. Thank you for your time. — ${name}`,
        })),
        tip: "Send the note to the recruiter or hiring manager on LinkedIn or by email; mark anything you hear back about with update_applications.",
      };
    }
    case "update_preferences": {
      const { data: p } = await sb.from("profiles").select("target_roles,keywords_include,keywords_exclude,excluded_companies,skills").eq("id", userId).single();
      const merge = (a: string[] | null | undefined, b: unknown) => [...new Set([...(a ?? []), ...((b as string[]) ?? [])])];
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (args.add_target_roles || args.remove_target_roles)
        patch.target_roles = merge(p?.target_roles, args.add_target_roles).filter(
          (r) => !((args.remove_target_roles as string[]) ?? []).some((x) => x.toLowerCase() === r.toLowerCase())
        );
      if (args.job_levels) patch.job_levels = args.job_levels;
      if (args.min_salary != null) patch.min_salary = Number(args.min_salary);
      if (args.locations) patch.locations = args.locations;
      if (args.relocation != null) patch.relocation = Boolean(args.relocation);
      if (args.add_keywords_include) patch.keywords_include = merge(p?.keywords_include, args.add_keywords_include);
      if (args.add_keywords_exclude) patch.keywords_exclude = merge(p?.keywords_exclude, args.add_keywords_exclude);
      if (args.add_excluded_companies) patch.excluded_companies = merge(p?.excluded_companies, args.add_excluded_companies);
      if (args.add_skills) patch.skills = merge(p?.skills, args.add_skills);
      const { error } = await sb.from("profiles").upsert({ id: userId, ...patch }, { onConflict: "id" });
      return error ? { error: error.message } : { updated: Object.keys(patch).filter((k) => k !== "updated_at"), note: "Takes effect on the next agent run" };
    }
    case "set_autopilot": {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), emergency_stop: false, mock_mode: false };
      if (args.auto_submit_enabled != null) patch.auto_submit_enabled = Boolean(args.auto_submit_enabled);
      if (args.paused != null) patch.paused = Boolean(args.paused);
      if (args.daily_apply_cap != null) patch.daily_apply_cap = Math.max(0, Math.min(MAX_DAILY_APPLY_CAP, Number(args.daily_apply_cap)));
      if (args.min_fit_score != null) patch.min_fit_score = Math.max(40, Math.min(95, Number(args.min_fit_score)));
      const { error } = await sb.from("autopilot_settings").upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
      return error ? { error: error.message } : { updated: patch };
    }
    case "run_agent_now": {
      const machine = await machineStatus();
      if (machine.state !== "idle") return { started: false, note: `A run is already ${machine.state} (since ${machine.since}). Queued jobs are picked up by it.` };
      return dispatchAgentRun(userId);
    }
  }
  if (name === "get_profile") {
    const { data: p } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!p) return { note: "No profile yet. Ask the user to open Resume & profile and save it." };
    const r = (p.resume_parsed ?? {}) as { summary?: string; experience?: { title: string; company: string }[]; projects?: { name: string }[]; education?: { school: string; degree?: string; field?: string; graduation?: string }[] };
    return {
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || null,
      resume_uploaded: Boolean(p.resume_path),
      resume_read: Boolean(r && Object.keys(r).length),
      summary: r.summary ?? null,
      experience: (r.experience ?? []).map((e) => `${e.title} at ${e.company}`),
      projects: (r.projects ?? []).map((x) => x.name),
      education: (r.education ?? []).map((e) => [e.degree, e.field, e.school, e.graduation].filter(Boolean).join(", ")),
      skills: (p.skills ?? []).slice(0, 60),
      target_roles: p.target_roles ?? [],
      job_levels: p.job_levels ?? [],
      locations: p.locations ?? [],
      min_salary: p.min_salary,
      missing: [
        !p.resume_path && "resume",
        !p.phone && "phone",
        !(p.city && p.state) && "city/state",
        p.work_authorized_us == null && "work authorization answer",
        p.sponsorship_needed == null && "sponsorship answer",
      ].filter(Boolean),
    };
  }
  return { error: `Unknown tool ${name}` };
}

// ── Conversations ────────────────────────────────────────────────────────
/** True when the database doesn't have migration 007 yet (no conversation_id column): one conversation only. */
const noConversations = (e: { message?: string; code?: string } | null) => Boolean(e && (e.code === "42703" || /conversation_id/.test(e.message ?? "")));
const LEGACY = "earlier";
const titleOf = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";

export async function GET(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sb = auth.supabase;
  const want = new URL(req.url).searchParams.get("conversation");
  if (want) {
    let q = sb.from("chat_messages").select("id,role,content,actions,created_at").eq("user_id", auth.user.id).order("created_at", { ascending: true }).limit(200);
    q = want === LEGACY ? q.is("conversation_id", null) : q.eq("conversation_id", want);
    const { data, error } = await q;
    if (noConversations(error)) {
      const { data: all } = await sb.from("chat_messages").select("id,role,content,actions,created_at").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(50);
      return NextResponse.json({ messages: (all ?? []).reverse(), legacy: true });
    }
    return NextResponse.json({ messages: data ?? [] });
  }
  const { data, error } = await sb
    .from("chat_messages")
    .select("conversation_id,role,content,created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (noConversations(error)) return NextResponse.json({ conversations: [{ id: LEGACY, title: "Chat", updated_at: null, count: 0 }], legacy: true });
  const groups = new Map<string, { id: string; title: string; updated_at: string; count: number; first: string }>();
  for (const m of data ?? []) {
    const id = (m.conversation_id as string | null) ?? LEGACY;
    const g = groups.get(id) ?? { id, title: "", updated_at: m.created_at as string, count: 0, first: "" };
    g.count++;
    // Rows come newest first, so the last user message seen is the conversation's first.
    if (m.role === "user") g.first = m.content as string;
    groups.set(id, g);
  }
  const conversations = [...groups.values()].map((g) => ({ id: g.id, title: g.id === LEGACY ? "Earlier chats" : titleOf(g.first), updated_at: g.updated_at, count: g.count }));
  return NextResponse.json({ conversations });
}

export async function DELETE(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("conversation");
  if (!id) return NextResponse.json({ error: "Which conversation?" }, { status: 400 });
  let q = auth.supabase.from("chat_messages").delete().eq("user_id", auth.user.id);
  q = id === LEGACY ? q.is("conversation_id", null) : q.eq("conversation_id", id);
  const { error } = await q;
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, user } = auth;
  const body = (await req.json()) as { message?: string; conversation_id?: string };
  const text = String(body.message ?? "").trim().slice(0, 2000);
  if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  const requested = body.conversation_id;
  const conversationId = requested === LEGACY ? null : uuid(requested) ? requested! : randomUUID();

  // 8 earlier messages: enough context, small enough to stay under Groq's per-minute token limit (a bigger prompt fell back to Gemini's slow pacing).
  let hist = supabase.from("chat_messages").select("role,content").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8);
  hist = conversationId ? hist.eq("conversation_id", conversationId) : hist.is("conversation_id", null);
  const { data: firstTry, error: histErr } = await hist;
  let history = firstTry;
  let legacy = false;
  if (noConversations(histErr)) {
    legacy = true;
    ({ data: history } = await supabase.from("chat_messages").select("role,content").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8));
  }
  const contents: GeminiContent[] = [];
  for (const m of (history ?? []).reverse()) {
    if (!m.content || FAILURE.test(m.content)) continue;
    m.content = String(m.content).slice(0, 1200);
    const role = m.role === "assistant" ? ("model" as const) : ("user" as const);
    const last = contents[contents.length - 1];
    if (last?.role === role) last.parts.push({ text: m.content });
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  if (contents[0]?.role === "model") contents.shift();
  const lastTurn = contents[contents.length - 1];
  if (lastTurn?.role === "user") lastTurn.parts.push({ text });
  else contents.push({ role: "user", parts: [{ text }] });
  const store = (row: Record<string, unknown>) => supabase.from("chat_messages").insert(legacy ? row : { ...row, conversation_id: conversationId });
  await store({ user_id: user.id, role: "user", content: text });

  const admin = serviceClient();
  const actions: { tool: string; args: Args; result: Record<string, unknown> }[] = [];
  let reply = "";
  const t0 = Date.now();
  try {
    const system = await systemFor(supabase, user.id);
    /** Up to `max` model turns; each tool call runs here. Returns the model's plain reply, or "" if it kept calling tools. */
    const rounds = async (max: number): Promise<string> => {
      for (let round = 0; round < max; round++) {
        const { parts, text: out } = await chatGenerate(admin, { contents, system, tools: TOOLS, userId: user.id, prefer: "backup" });
        const calls = parts.filter((p) => p.functionCall);
        if (!calls.length) return out.trim();
        contents.push({ role: "model", parts });
        const responses = [];
        for (const c of calls) {
          const { name, args, id } = c.functionCall!;
          let result: Record<string, unknown>;
          try {
            // Changes only when the LATEST message asks for one (an AI once replayed an old "cap of 20" request).
            const blocked = changeNotAsked(name, text);
            result = blocked ? { error: blocked } : await runTool(name, args ?? {}, supabase, user.id);
          } catch (err) {
            result = { error: (err as Error).message };
          }
          if (result.error) await logEvent(admin, { user_id: user.id, area: "chat", level: "warn", message: `Tool ${name} failed: ${String(result.error)}` });
          actions.push({ tool: name, args: args ?? {}, result });
          responses.push({ functionResponse: { ...(id ? { id } : {}), name, response: result } });
        }
        contents.push({ role: "user", parts: responses });
      }
      return "";
    };
    /** Send the model back to do what it skipped: a change it only talked about, or a lookup it guessed at. */
    const insist = async (nudge: string) => {
      contents.push({ role: "model", parts: [{ text: reply || "…" }] });
      contents.push({ role: "user", parts: [{ text: nudge }] });
      reply = await rounds(2);
    };
    reply = await rounds(6);
    // Follow-through: the user asked for a change the model talked about but never made (it congratulated
    // on an interview without recording it).
    const owed = expectedChanges(text).filter((tool) => !actions.some((a) => a.tool === tool));
    if (owed.length) await insist(`You haven't done part of what I asked: call ${owed.join(" and ")} now (look up the rows first if you need ids), then tell me exactly what changed.`);
    // Data questions are answered from tool results only: it once named a company and "30 days" from memory.
    const lookups = expectedLookups(text);
    if (lookups.length && !actions.length) await insist(`Don't answer from memory: call ${lookups.join(" or ")} first and answer only from what it returns.`);
    if (!reply && actions.length) {
      // Still calling tools — ask for a plain answer from what it found.
      contents.push({ role: "user", parts: [{ text: "Now answer me in plain words using what the tools returned. Don't call more tools." }] });
      const { text: final } = await chatGenerate(admin, { contents, system, userId: user.id, prefer: "backup" });
      reply = final.trim();
    }
    if (!reply) reply = "Sorry, I couldn't work that out. Try rephrasing?";
  } catch (e) {
    const msg = (e as Error).message;
    await logEvent(admin, { user_id: user.id, area: "chat", level: "error", message: `Chat failed: ${msg}`, meta: { ms: Date.now() - t0 } });
    reply =
      e instanceof FreeTierLimitError
        ? "I've paused AI chat to keep you on the free tier — today's AI quota (Gemini and the backup) is used up. Gemini resets at midnight Pacific time; everything else in the app still works."
        : /overloaded|503|network/i.test(msg)
          ? "AI is busy right now (Google's servers are overloaded). Please try again in a minute."
          : `Something went wrong talking to the AI. It's been logged on the System status page. (${msg.slice(0, 160)})`;
  }
  if (Date.now() - t0 > 15000) await logEvent(admin, { user_id: user.id, area: "chat", level: "warn", message: `Chat reply was slow (${Date.now() - t0} ms)` });
  await store({ user_id: user.id, role: "assistant", content: reply, actions });
  return NextResponse.json({ reply, actions, conversation_id: legacy ? LEGACY : conversationId });
}
