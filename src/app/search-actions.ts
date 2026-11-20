"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { agentCanSubmit } from "@/lib/v2/verify";

const LIVE_KEY = /^(remotive|jobicy|workday|himalayas|usajobs):[\w.:-]{1,200}$/;
const DB_KEY = /^db:[0-9a-f-]{36}$/i;
const MAX = 50;

type P = {
  id: string;
  source_key: string;
  title: string;
  company_name: string;
  url: string;
  apply_url: string | null;
  ats: string | null;
  level: string | null;
  locations: string[];
  is_remote: boolean;
  salary_min: number | null;
  salary_max: number | null;
  description: string | null;
  verification_status: string;
  verification_score: number | null;
};
const COLS = "id,source_key,title,company_name,url,apply_url,ats,level,locations,is_remote,salary_min,salary_max,description,verification_status,verification_score";

/**
 * Search → tick several jobs → "Apply with agent" (or "Queue"): every ticked job is saved to your roles and
 * handed to the agent. Jobs the agent can't send (an unverified employer, a site it can't submit on) go to
 * Needs you with their link. A live result is fetched again on the server — nothing the browser sends is
 * saved as a job — and gets the same employer check as everything else.
 */
export async function applySearchResults(form: FormData) {
  const { supabase, user } = await requireUser();
  const then = form.get("then") === "queue" ? "queue" : "apply";
  const term = String(form.get("term") ?? "").slice(0, 100);
  const back = String(form.get("back") ?? "/search");
  const fail = (m: string) => redirect(`${back.startsWith("/search") ? back : "/search"}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent(m)}`);

  const keys = [...new Set(form.getAll("pick").map(String))].filter((k) => DB_KEY.test(k) || LIVE_KEY.test(k)).slice(0, MAX);
  if (!keys.length) fail("Tick at least one job first.");

  // 1. The postings: saved ones by id, live ones fetched again and checked, then saved.
  const ids = keys.filter((k) => DB_KEY.test(k)).map((k) => k.slice(3));
  const live = keys.filter((k) => LIVE_KEY.test(k));
  const postings: P[] = [];
  if (ids.length) {
    const { data } = await supabase.from("job_postings").select(COLS).in("id", ids);
    postings.push(...((data ?? []) as P[]));
  }
  let missing = 0;
  if (live.length) {
    const db = serviceClient();
    const { data: known } = await db.from("job_postings").select(COLS).in("source_key", live);
    postings.push(...((known ?? []) as P[]));
    const todo = live.filter((k) => !(known ?? []).some((p) => p.source_key === k));
    if (todo.length) {
      const { resolveLiveHits } = await import("@/lib/v2/discovery/live-search");
      const { verifyPosting } = await import("@/lib/v2/verify");
      const found = await resolveLiveHits(todo, term);
      missing += todo.length - found.length;
      const now = new Date().toISOString();
      if (found.length) {
        const { data: saved, error } = await db
          .from("job_postings")
          .upsert(
            found.map((p) => {
              const v = verifyPosting(p);
              return { ...p, salary_min: p.salary_min ?? null, salary_max: p.salary_max ?? null, first_seen_at: now, last_seen_at: now, active: true, verification_status: v.status, verification_score: v.score, verification_signals: v.signals, verified_at: now };
            }),
            { onConflict: "source_key" }
          )
          .select(COLS);
        if (error) fail(`Couldn't save those jobs: ${error.message}`);
        postings.push(...((saved ?? []) as P[]));
      }
    }
  }
  if (!postings.length) fail("Those jobs couldn't be opened any more — they may have been taken down. Search again.");

  // A job board's page (Himalayas, Remotive, The Muse…) often links to the employer's own application form
  // on a site the agent can use. Switch to that link instead of handing the job back to you.
  {
    const { isAggregator, resolveDirectLink } = await import("@/lib/v2/discovery/resolve");
    const { verifyPosting } = await import("@/lib/v2/verify");
    const boards = postings.filter((p) => !agentCanSubmit(p) && isAggregator(p.apply_url || p.url)).slice(0, 20);
    const db = serviceClient();
    await Promise.all(
      boards.map(async (p) => {
        const direct = await resolveDirectLink(p.apply_url || p.url, 8000);
        if (!direct) return;
        const v = verifyPosting({ source: "search", source_key: p.source_key, company_name: p.company_name, title: p.title, level: (p.level ?? "mid") as never, locations: p.locations, is_remote: p.is_remote, url: p.url, apply_url: direct.url, ats: direct.ats, description: p.description ?? undefined });
        const { error } = await db.from("job_postings").update({ apply_url: direct.url, ats: direct.ats, verification_status: v.status, verification_score: v.score, verification_signals: v.signals, verified_at: new Date().toISOString() }).eq("id", p.id);
        if (!error) Object.assign(p, { apply_url: direct.url, ats: direct.ats, verification_status: v.status, verification_score: v.score });
      })
    );
  }

  // 2. Your roles (with the fit worked out from your profile).
  const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const { matchPosting, profileToMatch } = await import("@/lib/v2/match");
  const mp = profileToMatch(prof ?? {});
  const { data: jobs, error: jobErr } = await supabase
    .from("jobs")
    .upsert(
      postings.map((p) => {
        const m = matchPosting(mp, { ...p, description: p.description });
        return { user_id: user.id, idempotency_key: p.source_key, posting_id: p.id, title: p.title, company_name: p.company_name, url: p.url, source: "search", fit_score: m.score, fit_reasons: ["Added by you from search", ...m.reasons], trust_score: p.verification_score, dismissed: false };
      }),
      { onConflict: "user_id,idempotency_key" }
    )
    .select("id,posting_id");
  if (jobErr || !jobs) fail(`Couldn't add them: ${jobErr?.message ?? "unknown error"}`);
  const jobByPosting = new Map((jobs ?? []).map((j) => [j.posting_id as string, j.id as string]));

  // 3. Applications: queued for the agent, or handed to you. Ones already sent or in progress are left alone.
  const { data: existing } = await supabase.from("applications").select("job_id,status").eq("user_id", user.id).in("job_id", [...jobByPosting.values()]);
  const busy = new Set((existing ?? []).filter((a) => !["draft", "ignored", "failed"].includes(a.status as string)).map((a) => a.job_id as string));
  const now = new Date().toISOString();
  const rows = postings
    .filter((p) => jobByPosting.has(p.id) && !busy.has(jobByPosting.get(p.id)!))
    .map((p) => {
      const can = p.verification_status === "verified" && agentCanSubmit(p);
      return {
        user_id: user.id,
        job_id: jobByPosting.get(p.id)!,
        posting_id: p.id,
        apply_url: p.apply_url || p.url,
        ats: p.ats,
        status: can ? "queued" : "needs_user",
        requested_by: "user",
        status_updated_at: now,
        error: can
          ? null
          : p.verification_status !== "verified"
            ? "Added from search. The employer check didn’t pass, so the agent won’t send this one — open the posting and apply yourself if you trust it."
            : "Added from search. The agent can’t submit on this site — open the posting and apply yourself.",
      };
    });
  const queued = rows.filter((r) => r.status === "queued").length;
  const yours = rows.length - queued;
  if (rows.length) {
    const { data: apps, error } = await supabase.from("applications").upsert(rows, { onConflict: "user_id,job_id" }).select("id,status");
    if (error) fail(`Saved to your roles, but couldn’t queue them: ${error.message}`);
    if (apps?.length)
      await supabase.from("application_events").insert(
        apps.map((a) => ({ user_id: user.id, application_id: a.id, kind: a.status === "queued" ? "queued" : "note", source: "user", detail: a.status === "queued" ? "Queued from search" : "Added from search — apply yourself" }))
      );
  }

  let started = false;
  if (queued && then === "apply") {
    const { dispatchAgentRun, machineStatus } = await import("@/lib/v2/dispatch");
    if ((await machineStatus()).state === "idle") started = (await dispatchAgentRun(user.id)).started;
  }
  revalidatePath("/jobs");
  revalidatePath("/search");
  revalidatePath("/applications");
  revalidatePath("/dashboard");

  const parts = [
    queued ? `${queued} queued for the agent${then === "apply" ? (started ? " — a run is starting now" : " — it picks them up on the next run") : ""}` : "",
    yours ? `${yours} the agent can’t send (under Needs you, with the link to apply yourself)` : "",
    busy.size ? `${busy.size} already applied or in progress` : "",
    missing ? `${missing} couldn’t be opened any more` : "",
  ].filter(Boolean);
  redirect(`/applications?tab=all&msg=${encodeURIComponent(`${parts.join(". ")}.`)}`);
}
