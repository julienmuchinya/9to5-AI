import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiUser, serviceClient } from "@/lib/v2/session";
import { geminiGenerate, FreeTierLimitError, type GeminiContent, type GeminiTool } from "@/lib/v2/gemini";
import { freeTierSnapshot } from "@/lib/v2/freeTier";

export const maxDuration = 60;

const TOOLS: GeminiTool[] = [
  {
    name: "get_status",
    description: "Current agent status: matched jobs, applications by status, autopilot settings, last run, free-tier usage.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "search_jobs",
    description: "Search the user's matched jobs. Returns id, title, company, fit score, verification, location, pay.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to find in the title or company, e.g. 'backend', 'data', 'Stripe'" },
        level: { type: "string", enum: ["internship", "new_grad", "entry", "mid", "senior"] },
        min_fit: { type: "integer" },
        verified_only: { type: "boolean" },
        auto_submit_only: { type: "boolean", description: "Only jobs on Greenhouse/Lever/Ashby the agent can submit itself" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "queue_applications",
    description:
      "Queue applications for the agent to submit on its next run. Pass job_ids from search_jobs, or a query to queue every matching verified job. Max 25 at once.",
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
    description: "Turn automatic submission on/off, pause the agent, or change the daily cap / minimum fit score.",
    parameters: {
      type: "object",
      properties: {
        auto_submit_enabled: { type: "boolean" },
        paused: { type: "boolean" },
        daily_apply_cap: { type: "integer", description: "0-25 applications per day" },
        min_fit_score: { type: "integer", description: "40-95" },
      },
    },
  },
  {
    name: "run_agent_now",
    description: "Start an agent run right away instead of waiting for the schedule.",
    parameters: { type: "object", properties: {} },
  },
];

const SYSTEM = `You are 9to5 AI, a job-search agent working for the signed-in user.
You find real STEM jobs that match their resume, verify employers, and submit applications for them.
Use tools to act; never claim you did something unless a tool result confirms it.
Only verified jobs on Greenhouse, Lever or Ashby can be auto-submitted; others go to the user to submit.
Never invent facts about the user. Keep replies short, friendly and concrete (counts, company names).
If the user asks to apply broadly ("apply to all backend jobs"), search first, then queue the verified matches and say how many.`;

const clean = (s: string) => s.replace(/[,()%*]/g, " ").trim();

type Args = Record<string, unknown>;

async function runTool(name: string, args: Args, sb: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
  switch (name) {
    case "get_status": {
      const [{ count: matched }, apps, { data: settings }, { data: run }] = await Promise.all([
        sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("dismissed", false),
        sb.from("applications").select("status").eq("user_id", userId),
        sb.from("autopilot_settings").select("auto_submit_enabled,paused,daily_apply_cap,min_fit_score").eq("user_id", userId).single(),
        sb.from("agent_runs").select("started_at,status,summary").eq("user_id", userId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const byStatus: Record<string, number> = {};
      for (const a of apps.data ?? []) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      const free = await freeTierSnapshot(serviceClient());
      return {
        matched_jobs: matched ?? 0,
        applications: byStatus,
        autopilot: settings,
        last_run: run,
        gemini_today: `${free.gemini.used}/${free.gemini.limit}`,
      };
    }
    case "search_jobs":
    case "queue_applications": {
      const limit = Math.max(1, Math.min(25, Number(args.limit ?? (name === "search_jobs" ? 10 : 10))));
      let q = sb
        .from("jobs")
        .select("id,title,company_name,fit_score,posting_id,url, job_postings!inner(level,locations,is_remote,ats,verification_status,salary_max)")
        .eq("user_id", userId)
        .eq("dismissed", false)
        .order("fit_score", { ascending: false })
        .limit(limit);
      if (Array.isArray(args.job_ids) && args.job_ids.length) q = q.in("id", args.job_ids as string[]);
      if (args.query) {
        const t = clean(String(args.query));
        if (t) q = q.or(`title.ilike.%${t}%,company_name.ilike.%${t}%`);
      }
      if (args.level) q = q.eq("job_postings.level", String(args.level));
      if (args.min_fit) q = q.gte("fit_score", Number(args.min_fit));
      if (args.verified_only || name === "queue_applications") q = q.eq("job_postings.verification_status", "verified");
      if (args.auto_submit_only) q = q.in("job_postings.ats", ["greenhouse", "lever", "ashby"]);
      const { data, error } = await q;
      if (error) return { error: error.message };
      type Row = { id: string; title: string; company_name: string; fit_score: number; posting_id: string; url: string; job_postings: { level: string; locations: string[]; is_remote: boolean; ats: string; verification_status: string; salary_max: number | null } };
      const rows = (data ?? []) as unknown as Row[];
      if (name === "search_jobs")
        return {
          jobs: rows.map((r) => ({
            id: r.id,
            title: r.title,
            company: r.company_name,
            fit: r.fit_score,
            level: r.job_postings.level,
            location: r.job_postings.is_remote ? "Remote" : r.job_postings.locations.slice(0, 2).join("; "),
            pay_up_to: r.job_postings.salary_max,
            verification: r.job_postings.verification_status,
            agent_can_submit: ["greenhouse", "lever", "ashby"].includes(r.job_postings.ats),
          })),
        };
      if (!rows.length) return { queued: 0, note: "No verified matching jobs found" };
      const { error: upErr } = await sb.from("applications").upsert(
        rows.map((r) => ({ user_id: userId, job_id: r.id, posting_id: r.posting_id, apply_url: r.url, ats: r.job_postings.ats, status: "queued", requested_by: "chat" })),
        { onConflict: "user_id,job_id", ignoreDuplicates: true }
      );
      if (upErr) return { error: upErr.message };
      return { queued: rows.length, jobs: rows.map((r) => `${r.title} — ${r.company_name}`) };
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
      const { error } = await sb.from("profiles").update(patch).eq("id", userId);
      return error ? { error: error.message } : { updated: Object.keys(patch).filter((k) => k !== "updated_at"), note: "Takes effect on the next agent run" };
    }
    case "set_autopilot": {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), emergency_stop: false, mock_mode: false };
      if (args.auto_submit_enabled != null) patch.auto_submit_enabled = Boolean(args.auto_submit_enabled);
      if (args.paused != null) patch.paused = Boolean(args.paused);
      if (args.daily_apply_cap != null) patch.daily_apply_cap = Math.max(0, Math.min(25, Number(args.daily_apply_cap)));
      if (args.min_fit_score != null) patch.min_fit_score = Math.max(40, Math.min(95, Number(args.min_fit_score)));
      const { error } = await sb.from("autopilot_settings").update(patch).eq("user_id", userId);
      return error ? { error: error.message } : { updated: patch };
    }
    case "run_agent_now": {
      const token = process.env.GH_DISPATCH_TOKEN;
      const repo = process.env.GH_REPO ?? "julienmuchinya/9to5-AI";
      if (!token) return { started: false, note: "Instant runs aren't set up (GH_DISPATCH_TOKEN missing). The agent runs automatically every 3 hours." };
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/daily-agent.yml/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ ref: "main", inputs: { mode: "live", dry_run: "false", scan_email: "false", scan_companies: "true" } }),
      });
      return res.ok ? { started: true, note: "Run started; results in about 5-10 minutes." } : { started: false, error: `GitHub said ${res.status}` };
    }
  }
  return { error: `Unknown tool ${name}` };
}

export async function GET() {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data } = await auth.supabase
    .from("chat_messages")
    .select("id,role,content,actions,created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return NextResponse.json({ messages: (data ?? []).reverse() });
}

export async function POST(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, user } = auth;
  const { message } = (await req.json()) as { message?: string };
  const text = String(message ?? "").trim().slice(0, 2000);
  if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const { data: history } = await supabase
    .from("chat_messages")
    .select("role,content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(12);
  const contents: GeminiContent[] = (history ?? [])
    .reverse()
    .map((m) => ({ role: m.role === "assistant" ? ("model" as const) : ("user" as const), parts: [{ text: m.content }] }));
  contents.push({ role: "user", parts: [{ text }] });
  await supabase.from("chat_messages").insert({ user_id: user.id, role: "user", content: text });

  const admin = serviceClient();
  const actions: { tool: string; args: Args; result: Record<string, unknown> }[] = [];
  let reply = "";
  try {
    for (let round = 0; round < 4; round++) {
      const { parts, text: out } = await geminiGenerate(admin, { contents, system: SYSTEM, tools: TOOLS, userId: user.id });
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length) {
        reply = out.trim();
        break;
      }
      contents.push({ role: "model", parts });
      const responses = [];
      for (const c of calls) {
        const { name, args } = c.functionCall!;
        const result = await runTool(name, args ?? {}, supabase, user.id);
        actions.push({ tool: name, args: args ?? {}, result });
        responses.push({ functionResponse: { name, response: result } });
      }
      contents.push({ role: "user", parts: responses });
    }
    if (!reply) reply = actions.length ? "Done — see the actions above." : "Sorry, I couldn't work that out. Try rephrasing?";
  } catch (e) {
    reply =
      e instanceof FreeTierLimitError
        ? `I've paused AI chat to keep you on the free tier: ${e.message}. It resets tomorrow.`
        : `Something went wrong: ${(e as Error).message}`;
  }
  await supabase.from("chat_messages").insert({ user_id: user.id, role: "assistant", content: reply, actions });
  return NextResponse.json({ reply, actions });
}
