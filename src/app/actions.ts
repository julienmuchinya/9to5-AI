"use server";

import { looksLikeSecretValue, sensitiveField } from "@/lib/v2/sensitive";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/v2/session";
import { APP_QUESTIONS, customStore, findSimilarAnswer, isJobSpecific, memoryKey, type CustomAnswers, type FormRow, type PendingQuestion } from "@/lib/v2/app-questions";
import { DEFAULT_DAILY_CAP, DEFAULT_MIN_FIT, MAX_DAILY_APPLY_CAP } from "@/lib/v2/priority";
import { agentCanSubmit } from "@/lib/v2/verify";
import { readTuning } from "@/lib/v2/tuning";
import { ROLE_CATALOG } from "@/lib/v2/role-catalog";
import { appTabFilter, isAppTab } from "@/lib/v2/app-filter";
import { needsKind } from "@/lib/v2/needs";

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
const text = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s || null;
};
const tri = (v: FormDataEntryValue | null) => (v === "yes" ? true : v === "no" ? false : null);

export async function saveProfile(form: FormData) {
  const { supabase, user } = await requireUser();
  const first = text(form.get("first_name"));
  const last = text(form.get("last_name"));
  const answers: Record<string, string> = {};
  for (const q of APP_QUESTIONS) {
    const v = text(form.get(`aq_${q.key}`));
    if (v) answers[q.key] = v.slice(0, 300);
  }
  // Titles ticked under "More titles you could apply to" join the target roles.
  const roles = list(form.get("target_roles"));
  // A whole field ticked ("Healthcare — all") adds every title in it.
  const fromFields = form.getAll("add_fields").flatMap((f) => ROLE_CATALOG.find((g) => g.field === String(f))?.roles ?? []);
  for (const r of [...form.getAll("add_roles").map(String), ...fromFields]) if (!roles.some((x) => x.toLowerCase() === r.toLowerCase())) roles.push(r);
  const row = {
      application_answers: answers,
      id: user.id,
      first_name: first,
      last_name: last,
      full_name: [first, last].filter(Boolean).join(" ") || null,
      job_email: text(form.get("job_email")),
      phone: text(form.get("phone")),
      city: text(form.get("city")),
      state: text(form.get("state")),
      linkedin_url: text(form.get("linkedin_url")),
      github_url: text(form.get("github_url")),
      website_url: text(form.get("website_url")),
      school: text(form.get("school")),
      graduation_date: text(form.get("graduation_date")),
      work_authorized_us: tri(form.get("work_authorized_us")),
      sponsorship_needed: tri(form.get("sponsorship_needed")),
      relocation: form.get("relocation") === "on",
      target_roles: roles,
      skills: list(form.get("skills")),
      job_levels: form.getAll("job_levels").map(String),
      locations: form.getAll("locations").map(String),
      min_salary: Number(form.get("min_salary") || 0) || null,
      keywords_include: list(form.get("keywords_include")),
      keywords_exclude: list(form.get("keywords_exclude")),
      excluded_companies: list(form.get("excluded_companies")),
      updated_at: new Date().toISOString(),
  };
  let { error } = await supabase.from("profiles").upsert({ ...row, focus_roles: list(form.get("focus_roles")) }, { onConflict: "id" });
  // Database without migration 008 (no focus_roles column): save everything else.
  if (error && (error.code === "42703" || /focus_roles/.test(error.message))) ({ error } = await supabase.from("profiles").upsert(row, { onConflict: "id" }));
  if (error) throw new Error(`Couldn’t save your profile: ${error.message}`);
  revalidatePath("/profile");
  revalidatePath("/dashboard");
}

export async function saveAutopilot(form: FormData) {
  const { supabase, user } = await requireUser();
  const row = {
    user_id: user.id,
    auto_submit_enabled: form.get("auto_submit_enabled") === "on",
    paused: form.get("paused") === "on",
    emergency_stop: false,
    mock_mode: false,
    daily_apply_cap: Math.max(0, Math.min(MAX_DAILY_APPLY_CAP, Number(form.get("daily_apply_cap") || DEFAULT_DAILY_CAP))),
    min_fit_score: Math.max(40, Math.min(95, Number(form.get("min_fit_score") || DEFAULT_MIN_FIT))),
    updated_at: new Date().toISOString(),
  };
  // How the agent picks jobs (migration 010). readTuning clamps every value to its allowed range.
  const tuning = readTuning({
    max_age_days: form.get("max_age_days"),
    company_cap: form.get("company_cap"),
    order: form.get("order"),
    focus_first: form.get("focus_first") === "on",
    mine_first: form.get("mine_first") === "on",
  });
  let { error } = await supabase.from("autopilot_settings").upsert({ ...row, tuning }, { onConflict: "user_id" });
  if (error && (error.code === "42703" || error.code === "PGRST204" || /tuning/.test(error.message))) ({ error } = await supabase.from("autopilot_settings").upsert(row, { onConflict: "user_id" }));
  if (error) throw new Error(`Couldn’t save autopilot settings: ${error.message}`);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function queueJob(jobId: string) {
  const { supabase, user } = await requireUser();
  const { data: job } = await supabase.from("jobs").select("id,posting_id,url").eq("id", jobId).eq("user_id", user.id).single();
  if (!job) throw new Error("Job not found");
  const { error } = await supabase
    .from("applications")
    .upsert(
      { user_id: user.id, job_id: job.id, posting_id: job.posting_id, apply_url: job.url, status: "queued", requested_by: "user" },
      { onConflict: "user_id,job_id" }
    );
  if (error) throw new Error(error.message);
  revalidatePath("/jobs");
  revalidatePath("/applications");
}

/**
 * "Apply to all": queue every verified match the agent can submit that has no application yet, then
 * start a run. Jobs on other sites stay on the Jobs page with an "Apply yourself" link.
 */
export async function queueAllMatches(): Promise<void> {
  const { supabase, user } = await requireUser();
  const [{ data: jobs }, { data: apps }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id,posting_id,url, job_postings!inner(ats,apply_url,url,verification_status)")
      .eq("user_id", user.id)
      .eq("dismissed", false)
      .eq("job_postings.verification_status", "verified")
      .limit(1000),
    supabase.from("applications").select("job_id").eq("user_id", user.id),
  ]);
  const taken = new Set((apps ?? []).map((a) => a.job_id as string));
  type J = { id: string; posting_id: string; url: string; job_postings: { ats: string | null; apply_url: string | null; url: string; verification_status: string } };
  const rows = ((jobs ?? []) as unknown as J[]).filter((j) => !taken.has(j.id) && agentCanSubmit(j.job_postings));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("applications").upsert(
      rows.slice(i, i + 200).map((j) => ({ user_id: user.id, job_id: j.id, posting_id: j.posting_id, apply_url: j.job_postings.apply_url || j.url, ats: j.job_postings.ats, status: "queued", requested_by: "user" })),
      { onConflict: "user_id,job_id", ignoreDuplicates: true }
    );
    if (error) throw new Error(error.message);
  }
  if (rows.length) {
    const { dispatchAgentRun, machineStatus } = await import("@/lib/v2/dispatch");
    if ((await machineStatus()).state === "idle") await dispatchAgentRun(user.id);
  }
  revalidatePath("/jobs");
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  redirect(`/jobs?queued=${rows.length}`);
}

/** "Run now" button: starts an agent run for this user only. */
export async function runAgentNow(): Promise<{ started: boolean; note?: string; error?: string }> {
  const { user } = await requireUser();
  const { dispatchAgentRun } = await import("@/lib/v2/dispatch");
  const r = await dispatchAgentRun(user.id);
  revalidatePath("/applications");
  return r;
}

/** Put a "Needs you" or failed application back in the queue (e.g. after answering its question on the profile). */
export async function retryApplication(appId: string) {
  const { supabase, user } = await requireUser();
  await supabase.from("applications").update({ status: "queued", error: null, attempts: 0, pending_questions: null }).eq("id", appId).eq("user_id", user.id);
  revalidatePath("/applications");
}

/**
 * Re-queues every "Needs you" application whose waiting questions are now all answered
 * (exactly or by a very similar earlier answer). Returns how many went back in the queue.
 */
async function requeueAnswered(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string, custom: CustomAnswers): Promise<number> {
  const store = customStore(custom);
  const { data: waiting } = await supabase.from("applications").select("id,pending_questions").eq("user_id", userId).eq("status", "needs_user").not("pending_questions", "is", null);
  const ready = (waiting ?? [])
    .filter((w) => {
      const qs = (w.pending_questions ?? []) as PendingQuestion[];
      return qs.length > 0 && qs.every((q) => store[q.key] || findSimilarAnswer(q.label, q.options ?? [], store));
    })
    .map((w) => w.id as string);
  if (ready.length)
    await supabase
      .from("applications")
      .update({ status: "queued", error: "Your answers are saved — reapplying on the next run", attempts: 0, pending_questions: null })
      .in("id", ready)
      .eq("user_id", userId);
  return ready.length;
}

/** Answers to questions the agent couldn't answer (Applications → Needs you). Saved for every future form. */
export async function answerPendingQuestions(form: FormData) {
  const { supabase, user } = await requireUser();
  const { data: p } = await supabase.from("profiles").select("custom_answers").eq("id", user.id).maybeSingle();
  const custom: CustomAnswers = { ...((p?.custom_answers ?? {}) as CustomAnswers) };
  const now = new Date().toISOString();
  let saved = 0;
  const names = [...new Set([...form.keys()].filter((k) => k.startsWith("pq_")))];
  for (const name of names) {
    const key = name.slice(3);
    // Checkbox questions send one value per ticked choice.
    const a = form
      .getAll(name)
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .join(", ")
      .slice(0, 2000);
    const q = String(form.get(`pl_${key}`) ?? key).slice(0, 700);
    if (!a || !key) continue;
    // Never store a secret (SSN, card / account number, ID number, date of birth) as a reusable answer.
    if (sensitiveField(q) || looksLikeSecretValue(a)) continue;
    custom[key] = { q, a, at: now };
    saved++;
  }
  if (saved) {
    const { error } = await supabase.from("profiles").update({ custom_answers: custom }).eq("id", user.id);
    if (error) redirect(`/applications?tab=needs&msg=${encodeURIComponent("Couldn't save: " + error.message)}`);
  }
  const requeued = await requeueAnswered(supabase, user.id, custom);
  revalidatePath("/applications");
  revalidatePath("/profile");
  const msg = saved
    ? `Saved ${saved} answer${saved === 1 ? "" : "s"}. ${requeued} application${requeued === 1 ? "" : "s"} went back in the queue.`
    : "Nothing to save — fill in at least one answer.";
  redirect(`/applications?tab=needs&msg=${encodeURIComponent(msg)}`);
}

/**
 * Needs you → one application's whole form: every question in order, any answer changed, the missing ones filled.
 * Each changed answer is saved as the user's own answer (used on every application asking the same question, and it
 * overrides what the agent guessed before) unless it's specific to this company; the application goes back in the
 * queue once nothing is missing, and so do other applications the new answers unblock.
 */
export async function saveApplicationForm(form: FormData) {
  const { supabase, user } = await requireUser();
  const appId = String(form.get("app_id") ?? "");
  const back = (msg: string) => redirect(`/applications?tab=needs&msg=${encodeURIComponent(msg)}#app-${appId}`);
  const [{ data: app }, { data: p }] = await Promise.all([
    supabase.from("applications").select("id,answers,pending_questions,jobs(company_name)").eq("id", appId).eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("custom_answers").eq("id", user.id).maybeSingle(),
  ]);
  if (!app) back("Couldn't find that application");
  const company = (app as unknown as { jobs: { company_name: string } | null }).jobs?.company_name ?? "";
  const answers: Record<string, unknown> = { ...((app!.answers ?? {}) as Record<string, unknown>) };
  const rows: FormRow[] = Array.isArray(answers.__form) ? [...(answers.__form as FormRow[])] : [];
  const custom: CustomAnswers = { ...((p?.custom_answers ?? {}) as CustomAnswers) };
  const now = new Date().toISOString();
  let changed = 0;
  let remembered = 0;
  const n = Math.min(300, Number(form.get("rows") ?? 0) || 0);
  const stillMissing: string[] = [];
  for (let i = 0; i < n; i++) {
    const q = String(form.get(`q_${i}`) ?? "").slice(0, 700);
    if (!q) continue;
    const before = String(form.get(`o_${i}`) ?? "");
    const wasMissing = form.get(`m_${i}`) === "1";
    const fromResume = form.get(`r_${i}`) === "1";
    const a = form
      .getAll(`a_${i}`)
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .join(", ")
      .slice(0, 2000);
    if (!a) {
      if (wasMissing) stillMissing.push(q);
      continue;
    }
    if (a === before && !wasMissing) continue;
    // Never store a secret (SSN, card / account number, ID number, date of birth) anywhere.
    if (sensitiveField(q) || looksLikeSecretValue(a)) {
      if (wasMissing) stillMissing.push(q);
      continue;
    }
    changed++;
    answers[q] = a;
    const row = rows.find((r) => r.label === q);
    if (row) Object.assign(row, { answer: a, missing: false });
    // Reused on every application — except company-specific questions and resume blocks (those come from the resume).
    if (!fromResume && !isJobSpecific(q, company)) {
      custom[memoryKey(q)] = { q, a, at: now };
      remembered++;
    }
  }
  if (rows.length) answers.__form = rows;
  const pending = ((app!.pending_questions ?? []) as PendingQuestion[]).filter((pq) => stillMissing.includes(pq.label) || (!answers[pq.label] && !customStore(custom)[pq.key]));
  const done = pending.length === 0 && stillMissing.length === 0;
  const { error } = await supabase
    .from("applications")
    .update(done ? { answers, status: "queued", pending_questions: null, attempts: 0, error: "Your answers are saved — reapplying on the next run" } : { answers, pending_questions: pending })
    .eq("id", appId)
    .eq("user_id", user.id);
  if (error) back(`Couldn't save: ${error.message}`);
  if (remembered) {
    const { error: e2 } = await supabase.from("profiles").update({ custom_answers: custom }).eq("id", user.id);
    if (e2) back(`Saved on this application, but not for future ones: ${e2.message}`);
  }
  const requeued = await requeueAnswered(supabase, user.id, custom);
  revalidatePath("/applications");
  revalidatePath("/profile");
  if (!changed) back("Nothing changed — edit an answer or fill in the missing ones first.");
  back(
    `Saved ${changed} answer${changed === 1 ? "" : "s"}${remembered ? ` (${remembered} reused on every application from now on)` : ""}. ` +
      (done ? "This application goes back in the queue" : `${stillMissing.length || pending.length} still missing on this one`) +
      (requeued ? `; ${requeued} other application(s) were unblocked by the same answers.` : ".")
  );
}

/** Edit or delete saved answers (Profile → Your answers to other questions). Empty = delete. */
export async function updateCustomAnswers(form: FormData) {
  const { supabase, user } = await requireUser();
  const { data: p } = await supabase.from("profiles").select("custom_answers").eq("id", user.id).maybeSingle();
  const custom: CustomAnswers = { ...((p?.custom_answers ?? {}) as CustomAnswers) };
  for (const key of Object.keys(custom)) {
    if (!form.has(`ca_${key}`)) continue;
    const a = String(form.get(`ca_${key}`) ?? "").trim().slice(0, 2000);
    if (!a) delete custom[key];
    else if (a !== custom[key].a) custom[key] = { ...custom[key], a, at: new Date().toISOString() };
  }
  await supabase.from("profiles").update({ custom_answers: custom }).eq("id", user.id);
  await requeueAnswered(supabase, user.id, custom);
  revalidatePath("/profile");
  revalidatePath("/applications");
}

export async function dismissJob(jobId: string) {
  const { supabase, user } = await requireUser();
  await supabase.from("jobs").update({ dismissed: true }).eq("id", jobId).eq("user_id", user.id);
  revalidatePath("/jobs");
}

/**
 * Explore → Prepare application. "draft" records it for you only — the agent never touches drafts.
 * "queue" hands it to the agent for its next run. Both require an explicit acknowledgement on the form.
 * An optional note is kept on the application's timeline.
 */
export async function prepareApplication(jobId: string, input: { mode: "draft" | "queue"; note?: string; acknowledged: boolean }): Promise<{ ok: boolean; message: string; appId?: string }> {
  const { supabase, user } = await requireUser();
  if (!input.acknowledged) return { ok: false, message: "Tick the box to confirm first." };
  const { data: job } = await supabase.from("jobs").select("id,posting_id,url,job_postings(ats,apply_url,verification_status)").eq("id", jobId).eq("user_id", user.id).maybeSingle();
  if (!job) return { ok: false, message: "Job not found." };
  const p = (job as unknown as { job_postings: { ats: string | null; apply_url: string | null; verification_status: string } | null }).job_postings;
  if (input.mode === "queue" && p?.verification_status !== "verified") return { ok: false, message: "This employer isn’t verified, so the agent won’t apply. Save a draft and apply yourself." };
  const { data: existing } = await supabase.from("applications").select("id,status").eq("user_id", user.id).eq("job_id", jobId).maybeSingle();
  if (existing && !["draft", "ignored", "failed"].includes(existing.status as string))
    return { ok: false, message: "You already have an application for this job.", appId: existing.id as string };
  const status = input.mode === "queue" ? "queued" : "draft";
  const { data: app, error } = await supabase
    .from("applications")
    .upsert(
      { user_id: user.id, job_id: job.id, posting_id: job.posting_id, apply_url: p?.apply_url || job.url, ats: p?.ats ?? null, status, requested_by: "user", error: null, status_updated_at: new Date().toISOString() },
      { onConflict: "user_id,job_id" }
    )
    .select("id")
    .single();
  if (error || !app) return { ok: false, message: `Couldn’t save: ${error?.message ?? "unknown error"}` };
  const note = (input.note ?? "").trim().slice(0, 1000);
  await supabase.from("application_events").insert({
    user_id: user.id,
    application_id: app.id,
    kind: note ? "note" : status,
    source: "user",
    detail: note || (status === "draft" ? "Draft saved — not sent" : "Queued for the agent"),
  });
  // /jobs isn't revalidated here: the dialog shows its confirmation first and refreshes the page when closed.
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  return {
    ok: true,
    appId: app.id as string,
    message: status === "draft" ? "Draft saved. Nothing was sent — queue it from Applications when you’re ready." : "Queued. The agent applies on its next run; you’ll see the result in Applications.",
  };
}

/**
 * Edit, add or rename one answer on an application (Applications → details → Answers).
 * With "remember", it's also saved to your profile answers, so the agent uses it on every
 * application that asks the same question (including when this one is retried).
 */
export async function saveApplicationAnswer(appId: string, input: { question: string; answer: string; oldQuestion?: string; remember?: boolean }): Promise<{ ok: boolean; message: string }> {
  const { supabase, user } = await requireUser();
  const q = input.question.replace(/\s+/g, " ").trim().slice(0, 300);
  const a = input.answer.trim().slice(0, 5000);
  if (!q) return { ok: false, message: "Write the question." };
  if (!a) return { ok: false, message: "Write an answer, or use Delete to remove it." };
  const { data: app } = await supabase.from("applications").select("answers").eq("id", appId).eq("user_id", user.id).maybeSingle();
  if (!app) return { ok: false, message: "Application not found." };
  const answers: Record<string, string> = { ...((app.answers ?? {}) as Record<string, string>) };
  if (input.oldQuestion && input.oldQuestion !== q) delete answers[input.oldQuestion];
  answers[q] = a;
  const { error } = await supabase.from("applications").update({ answers }).eq("id", appId).eq("user_id", user.id);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  if (input.remember) {
    const { data: p } = await supabase.from("profiles").select("custom_answers").eq("id", user.id).maybeSingle();
    const custom: CustomAnswers = { ...((p?.custom_answers ?? {}) as CustomAnswers) };
    custom[memoryKey(q)] = { q, a: a.slice(0, 2000), at: new Date().toISOString() };
    const { error: e2 } = await supabase.from("profiles").update({ custom_answers: custom }).eq("id", user.id);
    if (e2) return { ok: false, message: `Saved on this application, but not to your profile: ${e2.message}` };
    revalidatePath("/profile");
  }
  revalidatePath("/applications");
  return { ok: true, message: input.remember ? "Saved — and used on every application that asks this." : "Saved on this application." };
}

/** Remove one answer from an application. */
export async function deleteApplicationAnswer(appId: string, question: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, user } = await requireUser();
  const { data: app } = await supabase.from("applications").select("answers").eq("id", appId).eq("user_id", user.id).maybeSingle();
  if (!app) return { ok: false, message: "Application not found." };
  const answers: Record<string, string> = { ...((app.answers ?? {}) as Record<string, string>) };
  delete answers[question];
  const { error } = await supabase.from("applications").update({ answers }).eq("id", appId).eq("user_id", user.id);
  if (error) return { ok: false, message: `Couldn't delete: ${error.message}` };
  revalidatePath("/applications");
  return { ok: true, message: "Answer deleted." };
}

/**
 * Find Jobs → search results: add a job that isn't one of your matches yet (from the shared job database,
 * or from a live web search), so you can save it or apply. A live result is fetched again on the server —
 * nothing the browser sends is saved as a posting — then checked like any other posting.
 */
export async function addSearchedJob(form: FormData) {
  const { supabase, user } = await requireUser();
  const postingId = String(form.get("posting_id") ?? "");
  const liveKey = String(form.get("live_key") ?? "");
  const term = String(form.get("term") ?? "").slice(0, 100);
  const back = String(form.get("back") ?? "/jobs");
  const fail = (m: string) => redirect(`${back.startsWith("/jobs") || back.startsWith("/search") ? back : "/jobs"}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent(m)}`);

  type P = { id: string; source_key: string; title: string; company_name: string; url: string; apply_url: string | null; level: string | null; locations: string[]; is_remote: boolean; salary_min: number | null; salary_max: number | null; description: string | null; source: string; verification_score: number | null };
  const COLS = "id,source_key,title,company_name,url,apply_url,level,locations,is_remote,salary_min,salary_max,description,source,verification_score";
  let posting: P | null = null;

  if (/^[0-9a-f-]{36}$/i.test(postingId)) {
    const { data } = await supabase.from("job_postings").select(COLS).eq("id", postingId).maybeSingle();
    posting = data as P | null;
  } else if (/^(remotive|jobicy|workday|himalayas|usajobs):[\w.:-]{1,200}$/.test(liveKey)) {
    const db = (await import("@/lib/v2/session")).serviceClient();
    const { data: existing } = await db.from("job_postings").select(COLS).eq("source_key", liveKey).maybeSingle();
    posting = existing as P | null;
    if (!posting) {
      const { resolveLiveHit } = await import("@/lib/v2/discovery/live-search");
      const { verifyPosting } = await import("@/lib/v2/verify");
      const p = await resolveLiveHit(liveKey, term);
      if (!p) fail("Couldn't open that job any more — it may have been taken down. Try the search again.");
      const v = verifyPosting(p!);
      const now = new Date().toISOString();
      const { data: saved, error } = await db
        .from("job_postings")
        .upsert(
          {
            ...p!,
            salary_min: p!.salary_min ?? null,
            salary_max: p!.salary_max ?? null,
            first_seen_at: now,
            last_seen_at: now,
            active: true,
            verification_status: v.status,
            verification_score: v.score,
            verification_signals: v.signals,
            verified_at: now,
          },
          { onConflict: "source_key" }
        )
        .select(COLS)
        .single();
      if (error) fail(`Couldn't add it: ${error.message}`);
      posting = saved as P;
    }
  }
  if (!posting) fail("That job wasn't found.");
  const p = posting!;

  const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const { matchPosting, profileToMatch } = await import("@/lib/v2/match");
  const m = matchPosting(profileToMatch(prof ?? {}), { ...p, level: p.level, description: p.description });
  const { data: job, error } = await supabase
    .from("jobs")
    .upsert(
      {
        user_id: user.id,
        idempotency_key: p.source_key,
        posting_id: p.id,
        title: p.title,
        company_name: p.company_name,
        url: p.url,
        source: "search",
        fit_score: m.score,
        fit_reasons: ["Added by you from search", ...m.reasons],
        trust_score: p.verification_score,
        dismissed: false,
      },
      { onConflict: "user_id,idempotency_key" }
    )
    .select("id")
    .single();
  if (error || !job) fail(`Couldn't add it: ${error?.message ?? "unknown error"}`);
  revalidatePath("/jobs");

  // Search → "Queue it" / "Apply now": hand it straight to the agent (Apply now also starts a run).
  const then = String(form.get("then") ?? "");
  if (then === "queue" || then === "apply") {
    let { data: full } = await supabase.from("job_postings").select("ats,apply_url,url,verification_status").eq("id", p.id).maybeSingle();
    // A job board's page often links to the employer's own form on a site the agent can use: switch to it.
    if (full && !agentCanSubmit(full)) {
      const { isAggregator, resolveDirectLink } = await import("@/lib/v2/discovery/resolve");
      const direct = isAggregator(full.apply_url || full.url) ? await resolveDirectLink(full.apply_url || full.url, 8000) : null;
      if (direct) {
        const { verifyPosting } = await import("@/lib/v2/verify");
        const { serviceClient } = await import("@/lib/v2/session");
        const v = verifyPosting({ source: "search", source_key: p.source_key, company_name: p.company_name, title: p.title, level: (p.level ?? "mid") as never, locations: p.locations, is_remote: p.is_remote, url: p.url, apply_url: direct.url, ats: direct.ats, description: p.description ?? undefined });
        const { error: e3 } = await serviceClient().from("job_postings").update({ apply_url: direct.url, ats: direct.ats, verification_status: v.status, verification_score: v.score, verification_signals: v.signals, verified_at: new Date().toISOString() }).eq("id", p.id);
        if (!e3) full = { ...full, apply_url: direct.url, ats: direct.ats, verification_status: v.status };
      }
    }
    const can = full && full.verification_status === "verified" && agentCanSubmit(full as { ats: string | null; apply_url: string | null; url: string; verification_status: string });
    const { data: existing } = await supabase.from("applications").select("id,status").eq("user_id", user.id).eq("job_id", job!.id).maybeSingle();
    if (existing && !["draft", "ignored", "failed"].includes(existing.status as string)) redirect(`/applications?tab=all&app=${existing.id}`);
    const status = can ? "queued" : "needs_user";
    const { data: app, error: e2 } = await supabase
      .from("applications")
      .upsert(
        {
          user_id: user.id,
          job_id: job!.id,
          posting_id: p.id,
          apply_url: full?.apply_url || p.url,
          ats: full?.ats ?? null,
          status,
          requested_by: "user",
          status_updated_at: new Date().toISOString(),
          error: can
            ? null
            : full?.verification_status !== "verified"
              ? "Added from search. The employer check didn’t pass, so the agent won’t send this one — open the posting and apply yourself if you trust it."
              : "Added from search. The agent can’t submit on this site — open the posting and apply yourself.",
        },
        { onConflict: "user_id,job_id" }
      )
      .select("id")
      .single();
    if (e2 || !app) fail(`Added to your roles, but couldn’t queue it: ${e2?.message ?? "unknown error"}`);
    await supabase.from("application_events").insert({ user_id: user.id, application_id: app!.id, kind: can ? "queued" : "note", source: "user", detail: can ? "Queued from search" : "Added from search — apply yourself" });
    let started = false;
    if (can && then === "apply") {
      const { dispatchAgentRun, machineStatus } = await import("@/lib/v2/dispatch");
      if ((await machineStatus()).state === "idle") started = (await dispatchAgentRun(user.id)).started;
    }
    revalidatePath("/applications");
    revalidatePath("/dashboard");
    const msg = !can
      ? "Added. The agent can’t send this one — it’s under Needs you with the link to apply yourself."
      : then === "apply"
        ? started
          ? "Queued, and a run is starting now."
          : "Queued. A run is already going (or can’t start right now); it picks this up next."
        : "Queued. The agent applies on its next run.";
    redirect(`/applications?tab=all&app=${app!.id}&msg=${encodeURIComponent(msg)}`);
  }
  redirect(`/jobs?job=${job!.id}&added=1`);
}

/** Bookmark a job for later (Find Jobs → Saved). Needs migration 011; before it runs this does nothing. */
export async function toggleSavedJob(jobId: string, save: boolean) {
  const { supabase, user } = await requireUser();
  await supabase.from("jobs").update({ saved_at: save ? new Date().toISOString() : null }).eq("id", jobId).eq("user_id", user.id);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
}

export async function markApplied(appId: string) {
  const { supabase, user } = await requireUser();
  await supabase
    .from("applications")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), status_updated_at: new Date().toISOString(), error: null, requested_by: "user" })
    .eq("id", appId)
    .eq("user_id", user.id);
  await supabase.from("application_events").insert({ user_id: user.id, application_id: appId, kind: "submitted", source: "user", detail: "You applied yourself" });
  revalidatePath("/applications");
}

const TRACK_STATUSES = ["submitted", "received", "under_review", "screening", "interview", "offer", "rejected", "withdrawn"];

/** Manual status change from the Applications page (e.g. a recruiter called you). */
export async function setApplicationStatus(appId: string, form: FormData) {
  const { supabase, user } = await requireUser();
  const status = String(form.get("status") ?? "");
  if (!TRACK_STATUSES.includes(status)) return;
  const note = text(form.get("note"));
  await supabase.from("applications").update({ status, status_updated_at: new Date().toISOString() }).eq("id", appId).eq("user_id", user.id);
  await supabase.from("application_events").insert({ user_id: user.id, application_id: appId, kind: status, source: "user", detail: note });
  revalidatePath("/applications");
}

/**
 * Applications → timeline → "Not right — remove": drops an event an email added by mistake (a newsletter,
 * a "we may invite you" confirmation, another application at the same company) and rebuilds the status
 * from what's left.
 */
export async function removeTimelineEvent(appId: string, eventId: string) {
  const { supabase, user } = await requireUser();
  const { data: app } = await supabase.from("applications").select("id,status,submitted_at").eq("id", appId).eq("user_id", user.id).maybeSingle();
  if (!app) return;
  await supabase.from("application_events").delete().eq("id", eventId).eq("application_id", appId).eq("user_id", user.id).neq("kind", "submitted");
  const { data: rest } = await supabase.from("application_events").select("kind").eq("application_id", appId).eq("user_id", user.id).order("created_at", { ascending: true });
  const { statusFromEvents } = await import("@/lib/v2/tracking");
  const before = app.status as string;
  // Only statuses that came from the timeline are rebuilt; queued / needs-you / drafts stay as they are.
  if (["submitted", "received", "under_review", "screening", "interview", "offer", "rejected"].includes(before)) {
    const status = statusFromEvents("submitted", (rest ?? []).map((e) => e.kind as string));
    if (status !== before) {
      await supabase.from("applications").update({ status, status_updated_at: new Date().toISOString() }).eq("id", appId).eq("user_id", user.id);
      await supabase.from("application_events").insert({ user_id: user.id, application_id: appId, kind: "note", source: "user", detail: `Removed a wrong email update — back to “${status.replace("_", " ")}”` });
    }
  }
  revalidatePath("/applications");
  revalidatePath("/dashboard");
}

/** Connect an inbox (Gmail app password) so the agent can track replies. */
export async function saveInbox(form: FormData) {
  const { supabase, user } = await requireUser();
  const { encryptSecret } = await import("@/lib/v2/vault");
  const email = text(form.get("inbox_email"));
  const pass = String(form.get("inbox_password") ?? "").replace(/\s+/g, "");
  const host = text(form.get("inbox_host")) ?? "imap.gmail.com";
  const back = (m: string) => redirect(`/settings?inbox=${encodeURIComponent(m)}#inbox`);
  if (!email || !pass) back("Enter the Gmail address and its app password.");
  if (/(gmail|googlemail)\.com$/i.test(email!) && !/^[a-z]{16}$/i.test(pass))
    back("That isn't a Gmail app password. App passwords are exactly 16 letters (shown as four groups of four). Create one at myaccount.google.com/apppasswords — your normal Gmail password won't work.");
  // Check the login now instead of failing silently on the next agent run.
  const test = await testImapLogin(host, email!, pass);
  if (test) back(test);
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, inbox_email: email, inbox_host: host, inbox_password_enc: encryptSecret(pass), inbox_error: null }, { onConflict: "id" });
  if (error) back(`Couldn’t save the inbox: ${error.message}`);
  revalidatePath("/settings");
  redirect("/settings?inbox=ok#inbox");
}

/** Returns null when the IMAP login works, otherwise a message the user can act on. */
async function testImapLogin(host: string, email: string, pass: string): Promise<string | null> {
  const { ImapFlow } = await import("imapflow");
  const { inboxErrorMessage } = await import("../../agent/v2/mailcode");
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: email, pass }, logger: false, connectionTimeout: 15000, greetingTimeout: 10000 });
  try {
    await client.connect();
    await client.logout().catch(() => {});
    return null;
  } catch (e) {
    client.close();
    return inboxErrorMessage(e);
  }
}

export async function disconnectInbox() {
  const { supabase, user } = await requireUser();
  await supabase.from("profiles").update({ inbox_email: null, inbox_host: null, inbox_password_enc: null, inbox_error: null, inbox_last_scan_at: null }).eq("id", user.id);
  revalidatePath("/settings");
}

const BULK_ACTIONS = ["retry", "ignore", "applied", "rejected", "withdrawn", "delete"] as const;
const BULK_MAX = 5000;

/** Every application id in one Applications view (tab + optional Needs-you reason), across all pages. */
async function idsInView(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string, tab: string, why: string): Promise<string[]> {
  const out: string[] = [];
  if (tab === "needs" && why) {
    // The reason is worked out from each application's error and open questions, same as the page does.
    const { data: p } = await supabase.from("profiles").select("custom_answers").eq("id", userId).maybeSingle();
    const mine = customStore(p?.custom_answers as CustomAnswers | null);
    const { data } = await supabase.from("applications").select("id,error,pending_questions").eq("user_id", userId).eq("status", "needs_user").limit(BULK_MAX);
    for (const r of (data ?? []) as { id: string; error: string | null; pending_questions: PendingQuestion[] | null }[]) {
      const open = (r.pending_questions ?? []).filter((q) => !findSimilarAnswer(q.label, q.options ?? [], mine));
      if (needsKind(r.error, open.length) === why) out.push(r.id);
    }
    return out;
  }
  const f = appTabFilter(tab);
  for (let from = 0; from < BULK_MAX; from += 1000) {
    let q = supabase.from("applications").select("id").eq("user_id", userId);
    if (f.or) q = q.or(f.or);
    if (f.statuses) q = q.in("status", f.statuses);
    const { data, error } = await q.order("created_at", { ascending: false }).range(from, from + 999);
    if (error || !data?.length) break;
    out.push(...data.map((r) => r.id as string));
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * Applications page: one action on many applications — either the ticked ones, or (scope = "all")
 * every application in the current view, across all pages.
 */
export async function bulkApplications(form: FormData) {
  const { supabase, user } = await requireUser();
  const action = String(form.get("action") ?? "") as (typeof BULK_ACTIONS)[number];
  const back = String(form.get("back") ?? "/applications");
  const done = (m: string) => redirect(`${back.startsWith("/applications") ? back.split("#")[0] : "/applications"}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent(m)}`);
  if (!BULK_ACTIONS.includes(action)) done("Pick an action.");
  const tab = String(form.get("tab") ?? "");
  const ids =
    form.get("scope") === "all" && isAppTab(tab)
      ? await idsInView(supabase, user.id, tab, String(form.get("why") ?? ""))
      : [...new Set(form.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, BULK_MAX);
  if (!ids.length) done("Select at least one application first.");
  const now = new Date().toISOString();
  // Large selections go in batches (URL length limits on .in()).
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const scope = () => supabase.from("applications");
    const events = (kind: string, detail: string) =>
      supabase.from("application_events").insert(part.map((id) => ({ user_id: user.id, application_id: id, kind, source: "user", detail })));
    if (action === "retry") {
      await scope().update({ status: "queued", error: null, attempts: 0, pending_questions: null, status_updated_at: now }).in("id", part).eq("user_id", user.id);
    } else if (action === "ignore") {
      // Stop asking about it: out of Needs you and the queue. Its own status, so it never counts as sent.
      await scope().update({ status: "ignored", status_updated_at: now, pending_questions: null }).in("id", part).eq("user_id", user.id);
      await events("ignored", "Ignored by you");
    } else if (action === "applied") {
      await scope().update({ status: "submitted", submitted_at: now, status_updated_at: now, error: null, pending_questions: null }).in("id", part).eq("user_id", user.id);
      await events("submitted", "Marked as applied");
    } else if (action === "rejected" || action === "withdrawn") {
      await scope().update({ status: action, status_updated_at: now, pending_questions: null }).in("id", part).eq("user_id", user.id);
      await events(action, "Updated from the Applications page");
    } else if (action === "delete") {
      await scope().delete().in("id", part).eq("user_id", user.id);
    }
  }
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  const label = { retry: "back in the queue", ignore: "ignored (see Closed / ignored)", applied: "marked as applied", rejected: "marked rejected", withdrawn: "withdrawn", delete: "deleted" }[action];
  done(`${ids.length} application${ids.length === 1 ? "" : "s"} ${label}.`);
}
