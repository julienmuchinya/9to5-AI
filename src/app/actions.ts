"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/v2/session";
import { APP_QUESTIONS, customStore, findSimilarAnswer, type CustomAnswers, type PendingQuestion } from "@/lib/v2/app-questions";
import { MAX_DAILY_APPLY_CAP } from "@/lib/v2/priority";

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
  const { error } = await supabase
    .from("profiles")
    .upsert({
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
      target_roles: list(form.get("target_roles")),
      skills: list(form.get("skills")),
      job_levels: form.getAll("job_levels").map(String),
      locations: form.getAll("locations").map(String),
      min_salary: Number(form.get("min_salary") || 0) || null,
      keywords_include: list(form.get("keywords_include")),
      keywords_exclude: list(form.get("keywords_exclude")),
      excluded_companies: list(form.get("excluded_companies")),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
  if (error) throw new Error(`Couldn’t save your profile: ${error.message}`);
  revalidatePath("/profile");
  revalidatePath("/dashboard");
}

export async function saveAutopilot(form: FormData) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("autopilot_settings")
    .upsert({
      user_id: user.id,
      auto_submit_enabled: form.get("auto_submit_enabled") === "on",
      paused: form.get("paused") === "on",
      emergency_stop: false,
      mock_mode: false,
      daily_apply_cap: Math.max(0, Math.min(MAX_DAILY_APPLY_CAP, Number(form.get("daily_apply_cap") || 5))),
      min_fit_score: Math.max(40, Math.min(95, Number(form.get("min_fit_score") || 65))),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
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
      return qs.length > 0 && qs.every((q) => findSimilarAnswer(q.label, q.options ?? [], store));
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
    const q = String(form.get(`pl_${key}`) ?? key).slice(0, 300);
    if (!a || !key) continue;
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

const TRACK_STATUSES = ["submitted", "received", "under_review", "interview", "offer", "rejected", "withdrawn"];

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

const BULK_ACTIONS = ["retry", "applied", "rejected", "withdrawn", "delete"] as const;

/** Applications page: one action on many selected applications. */
export async function bulkApplications(form: FormData) {
  const { supabase, user } = await requireUser();
  const ids = [...new Set(form.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 500);
  const action = String(form.get("action") ?? "") as (typeof BULK_ACTIONS)[number];
  const back = String(form.get("back") ?? "/applications");
  const done = (m: string) => redirect(`${back.startsWith("/applications") ? back.split("#")[0] : "/applications"}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent(m)}`);
  if (!ids.length) done("Select at least one application first.");
  if (!BULK_ACTIONS.includes(action)) done("Pick an action.");
  const now = new Date().toISOString();
  const scope = () => supabase.from("applications");
  if (action === "retry") {
    await scope().update({ status: "queued", error: null, attempts: 0, pending_questions: null, status_updated_at: now }).in("id", ids).eq("user_id", user.id);
  } else if (action === "applied") {
    await scope().update({ status: "submitted", submitted_at: now, status_updated_at: now, error: null, pending_questions: null }).in("id", ids).eq("user_id", user.id);
    await supabase.from("application_events").insert(ids.map((id) => ({ user_id: user.id, application_id: id, kind: "submitted", source: "user", detail: "Marked as applied" })));
  } else if (action === "rejected" || action === "withdrawn") {
    await scope().update({ status: action, status_updated_at: now, pending_questions: null }).in("id", ids).eq("user_id", user.id);
    await supabase.from("application_events").insert(ids.map((id) => ({ user_id: user.id, application_id: id, kind: action, source: "user", detail: "Updated from the Applications page" })));
  } else if (action === "delete") {
    await scope().delete().in("id", ids).eq("user_id", user.id);
  }
  revalidatePath("/applications");
  const label = { retry: "back in the queue", applied: "marked as applied", rejected: "marked rejected", withdrawn: "withdrawn", delete: "deleted" }[action];
  done(`${ids.length} application${ids.length === 1 ? "" : "s"} ${label}.`);
}
