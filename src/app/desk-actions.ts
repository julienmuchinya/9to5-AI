"use server";

import { revalidatePath } from "next/cache";
import { requireUser, serviceClient } from "@/lib/v2/session";
import { loadLibrary } from "@/lib/v2/resume-library";
import { MAX_DAILY_APPLY_CAP } from "@/lib/v2/priority";
import { STAGE_LABEL } from "@/lib/v2/tracking";
import type { ParsedResume } from "@/lib/v2/resume";

/** Everything the Profile & preferences drawer shows, loaded when it opens. */
export interface DeskData {
  profile: {
    name: string;
    email: string;
    jobEmail: string | null;
    phone: string | null;
    place: string | null;
    workAuthorized: boolean | null;
    sponsorship: boolean | null;
    headline: string | null;
  };
  resumes: { id: string; label: string; uploaded: string | null; read: boolean }[];
  preferences: { roles: string[]; focus: string[]; levels: string[]; locations: string[]; minSalary: number | null; relocation: boolean | null; skills: number };
  agent: { paused: boolean; autoSubmit: boolean; dailyCap: number };
  security: { email: string; hasQuestions: boolean; inbox: string | null; lastSignIn: string | null };
}

const LOC: Record<string, string> = { remote_us: "Remote (US)", my_state: "In my state", anywhere_us: "Anywhere in the US", GA: "Georgia" };

export async function getDeskData(): Promise<DeskData> {
  const { supabase, user } = await requireUser();
  const [{ data: p }, { data: s }, { data: sq }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("autopilot_settings").select("paused,auto_submit_enabled,daily_apply_cap").eq("user_id", user.id).maybeSingle(),
    serviceClient().from("security_questions").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  const lib = await loadLibrary(supabase, user.id, {
    resume_path: p?.resume_path ?? null,
    resume_parsed: (p?.resume_parsed ?? null) as ParsedResume | null,
    resume_updated_at: p?.resume_updated_at ?? null,
  }).catch(() => ({ resumes: [] }));
  const parsed = (p?.resume_parsed ?? {}) as { skills?: string[]; experience?: { title?: string }[] };
  return {
    profile: {
      name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.full_name || "",
      email: user.email ?? "",
      jobEmail: p?.job_email ?? null,
      phone: p?.phone ?? null,
      place: [p?.city, p?.state].filter(Boolean).join(", ") || null,
      workAuthorized: p?.work_authorized_us ?? null,
      sponsorship: p?.sponsorship_needed ?? null,
      headline: parsed.experience?.[0]?.title ?? (p?.target_roles as string[] | null)?.[0] ?? null,
    },
    resumes: lib.resumes.map((r) => ({ id: r.id, label: r.label, uploaded: r.uploaded_at || null, read: Boolean(r.parsed && Object.keys(r.parsed).length) || r.id !== "main" })),
    preferences: {
      roles: (p?.target_roles as string[] | null) ?? [],
      focus: (p?.focus_roles as string[] | null) ?? [],
      levels: (p?.job_levels as string[] | null) ?? [],
      locations: ((p?.locations as string[] | null) ?? []).map((l) => LOC[l] ?? l),
      minSalary: p?.min_salary ?? null,
      relocation: p?.relocation ?? null,
      skills: [...new Set([...((p?.skills as string[] | null) ?? []), ...(parsed.skills ?? [])])].length,
    },
    agent: { paused: Boolean(s?.paused), autoSubmit: Boolean(s?.auto_submit_enabled), dailyCap: s?.daily_apply_cap ?? 0 },
    security: { email: user.email ?? "", hasQuestions: Boolean(sq), inbox: p?.inbox_email ?? null, lastSignIn: user.last_sign_in_at ?? null },
  };
}

/**
 * Agent rules from the drawer: pause, auto-submit, daily limit. Updates only these three columns,
 * so every other autopilot setting stays as it was.
 */
export async function setAgentRules(input: { paused?: boolean; autoSubmit?: boolean; dailyCap?: number }): Promise<{ ok: boolean; message: string }> {
  const { supabase, user } = await requireUser();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.paused === "boolean") patch.paused = input.paused;
  if (typeof input.autoSubmit === "boolean") patch.auto_submit_enabled = input.autoSubmit;
  if (typeof input.dailyCap === "number" && Number.isFinite(input.dailyCap)) patch.daily_apply_cap = Math.max(0, Math.min(MAX_DAILY_APPLY_CAP, Math.round(input.dailyCap)));
  const { error } = await supabase.from("autopilot_settings").update(patch).eq("user_id", user.id);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

export interface DeskNotice {
  id: string;
  kind: "needs" | "reply" | "error" | "submitted";
  title: string;
  detail: string;
  at: string;
  href: string;
}

/** The alerts drawer: things that need you, replies from employers, submissions and errors (last 14 days). */
export async function getNotifications(): Promise<DeskNotice[]> {
  const { supabase, user } = await requireUser();
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [{ data: needs }, { data: events }, { data: errors }] = await Promise.all([
    supabase.from("applications").select("id,error,status_updated_at,created_at,jobs(title,company_name)").eq("user_id", user.id).eq("status", "needs_user").order("created_at", { ascending: false }).limit(6),
    supabase
      .from("application_events")
      .select("application_id,kind,source,detail,created_at,applications(jobs(title,company_name))")
      .eq("user_id", user.id)
      .in("source", ["email", "agent"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(12),
    serviceClient().from("agent_logs").select("created_at,message").eq("user_id", user.id).eq("level", "error").gte("created_at", since).order("created_at", { ascending: false }).limit(3),
  ]);
  type J = { title?: string; company_name?: string } | null;
  const out: DeskNotice[] = [];
  for (const r of (needs ?? []) as unknown as { id: string; error: string | null; status_updated_at: string | null; created_at: string; jobs: J }[]) {
    out.push({
      id: `n-${r.id}`,
      kind: "needs",
      title: `${r.jobs?.title ?? "An application"} needs you`,
      detail: `${r.jobs?.company_name ?? ""}${r.error ? ` · ${r.error.slice(0, 90)}` : ""}`,
      at: r.status_updated_at ?? r.created_at,
      href: `/applications?tab=needs&app=${r.id}`,
    });
  }
  for (const e of (events ?? []) as unknown as { application_id: string; kind: string; source: string; detail: string | null; created_at: string; applications: { jobs: J } | null }[]) {
    const job = e.applications?.jobs;
    out.push({
      id: `e-${e.application_id}-${e.created_at}`,
      kind: e.source === "email" ? "reply" : "submitted",
      title: `${STAGE_LABEL[e.kind] ?? e.kind}: ${job?.title ?? "an application"}`,
      detail: `${job?.company_name ?? ""}${e.source === "email" ? " · from your inbox" : " · by the agent"}`,
      at: e.created_at,
      href: `/applications?tab=all&app=${e.application_id}`,
    });
  }
  for (const l of errors ?? []) {
    out.push({ id: `x-${l.created_at}`, kind: "error", title: "The agent hit a problem", detail: String(l.message).slice(0, 120), at: l.created_at as string, href: "/status?level=error" });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 20);
}

const LEVELS = ["internship", "new_grad", "entry", "mid", "senior"];
const LOCATION_CHOICES = ["remote_us", "my_state", "anywhere_us"];

/**
 * Setup wizard (/start). Each step updates only its own profile columns, so nothing else on the
 * profile is overwritten.
 */
export async function saveOnboarding(
  input:
    | { step: "roles"; roles: string[] }
    | { step: "constraints"; locations: string[]; state: string; minSalary: number | null; relocation: boolean; levels: string[] }
): Promise<{ ok: boolean; message: string }> {
  const { supabase, user } = await requireUser();
  let patch: Record<string, unknown>;
  if (input.step === "roles") {
    const roles = [...new Set(input.roles.map((r) => r.replace(/\s+/g, " ").trim()).filter((r) => r.length >= 2 && r.length <= 80))].slice(0, 40);
    if (!roles.length) return { ok: false, message: "Pick at least one kind of work." };
    patch = { target_roles: roles };
  } else {
    const locations = input.locations.filter((l) => LOCATION_CHOICES.includes(l));
    if (!locations.length) return { ok: false, message: "Pick at least one place you’d work." };
    const state = input.state.trim().toUpperCase().slice(0, 2);
    if (locations.includes("my_state") && !/^[A-Z]{2}$/.test(state)) return { ok: false, message: "Add your state (two letters, e.g. TX) for “In my state”." };
    patch = {
      locations,
      ...(state ? { state } : {}),
      min_salary: input.minSalary && input.minSalary > 0 ? Math.min(1_000_000, Math.round(input.minSalary)) : null,
      relocation: input.relocation,
      job_levels: input.levels.filter((l) => LEVELS.includes(l)).length ? input.levels.filter((l) => LEVELS.includes(l)) : ["internship", "new_grad", "entry"],
    };
  }
  const { error } = await supabase.from("profiles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) return { ok: false, message: `Couldn’t save: ${error.message}` };
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  return { ok: true, message: "Saved." };
}
