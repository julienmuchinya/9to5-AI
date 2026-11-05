"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/v2/session";

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
  const { error } = await supabase
    .from("profiles")
    .upsert({
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
      daily_apply_cap: Math.max(0, Math.min(25, Number(form.get("daily_apply_cap") || 5))),
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
  if (!email || !pass) throw new Error("Enter the email and its app password.");
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, inbox_email: email, inbox_host: host, inbox_password_enc: encryptSecret(pass), inbox_error: null }, { onConflict: "id" });
  if (error) throw new Error(`Couldn’t save the inbox: ${error.message}`);
  revalidatePath("/settings");
}

export async function disconnectInbox() {
  const { supabase, user } = await requireUser();
  await supabase.from("profiles").update({ inbox_email: null, inbox_password_enc: null, inbox_error: null }).eq("id", user.id);
  revalidatePath("/settings");
}
