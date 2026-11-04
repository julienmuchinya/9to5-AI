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
    .update({
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
    })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/profile");
  revalidatePath("/dashboard");
}

export async function saveAutopilot(form: FormData) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("autopilot_settings")
    .update({
      auto_submit_enabled: form.get("auto_submit_enabled") === "on",
      paused: form.get("paused") === "on",
      emergency_stop: false,
      mock_mode: false,
      daily_apply_cap: Math.max(0, Math.min(25, Number(form.get("daily_apply_cap") || 5))),
      min_fit_score: Math.max(40, Math.min(95, Number(form.get("min_fit_score") || 65))),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
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
    .update({ status: "submitted", submitted_at: new Date().toISOString(), error: null, requested_by: "user" })
    .eq("id", appId)
    .eq("user_id", user.id);
  revalidatePath("/applications");
}
