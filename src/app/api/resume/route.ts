import { NextResponse } from "next/server";
import { apiUser, serviceClient } from "@/lib/v2/session";
import { evidenceFromResume, parseResumePdf, resumeToText } from "@/lib/v2/resume";
import { FreeTierLimitError } from "@/lib/v2/gemini";
import { freeTierSnapshot } from "@/lib/v2/freeTier";
import { logEvent } from "@/lib/v2/log";
import { loadLibrary, resumeFilePath, saveLibrary } from "@/lib/v2/resume-library";
import { renderClassicResume } from "@/lib/v2/resume-render";

export const maxDuration = 60;

const newId = () => Math.random().toString(36).slice(2, 10);
const cleanLabel = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const validId = (s: string | null | undefined): s is string => Boolean(s && /^[a-z0-9]{1,12}$/.test(s));

/**
 * Upload / re-read a resume. Form fields: resume (PDF, optional for "read it again"),
 * id ("main" = the profile resume, an existing library id, or "new"), label (optional name).
 */
export async function POST(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const { supabase, user } = auth;
  const admin = serviceClient();
  const t0 = Date.now();

  const form = await req.formData().catch(() => null);
  const file = form?.get("resume");
  const requested = String(form?.get("id") ?? "main");
  const id = requested === "new" ? newId() : validId(requested) ? requested : "main";
  const label = cleanLabel(form?.get("label"));
  const path = resumeFilePath(user.id, id);

  let bytes: Buffer;
  if (file instanceof File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "Please upload a PDF file." }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "That PDF is empty." }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "PDF must be under 5 MB." }, { status: 400 });
    const limits = await freeTierSnapshot(admin);
    if (!limits.storage.allowed) return NextResponse.json({ error: limits.storage.reason }, { status: 429 });
    bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== "%PDF-") return NextResponse.json({ error: "That file isn’t a real PDF. Export your resume as PDF and try again." }, { status: 400 });
    const up = await supabase.storage.from("resumes").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) {
      await logEvent(admin, { user_id: user.id, area: "resume", level: "error", message: `Upload failed: ${up.error.message}` });
      return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });
    }
    // Record the upload right away, so it isn't lost if reading fails.
    if (id === "main") await supabase.from("profiles").upsert({ id: user.id, resume_path: path, resume_updated_at: new Date().toISOString() }, { onConflict: "id" });
  } else {
    // "Read it again" — re-parse the PDF we already stored.
    const dl = await supabase.storage.from("resumes").download(path);
    if (dl.error || !dl.data) return NextResponse.json({ error: "No resume uploaded yet. Choose a PDF first." }, { status: 404 });
    bytes = Buffer.from(await dl.data.arrayBuffer());
  }

  let parsed;
  try {
    parsed = await parseResumePdf(admin, bytes, user.id);
  } catch (e) {
    const msg = (e as Error).message;
    await logEvent(admin, { user_id: user.id, area: "resume", level: "error", message: `Couldn't read resume: ${msg}` });
    const status = e instanceof FreeTierLimitError ? 429 : 502;
    return NextResponse.json({ error: `Your PDF is saved, but the AI couldn’t read it yet: ${msg.slice(0, 220)}`, saved: true, retry: true }, { status });
  }
  if (!parsed || (!parsed.skills?.length && !parsed.experience?.length && !parsed.education?.length)) {
    await logEvent(admin, { user_id: user.id, area: "resume", level: "warn", message: "Resume read but no content found (scanned image PDF?)" });
    return NextResponse.json({ error: "Your PDF is saved, but no text was found in it. If it’s a scanned image, export it from Word/Google Docs as PDF instead.", saved: true }, { status: 422 });
  }

  // Keep the resume list up to date. Extra resumes live only there; they never overwrite the profile.
  const { data: prof } = await supabase.from("profiles").select("resume_path,resume_parsed,resume_updated_at").eq("id", user.id).maybeSingle();
  const lib = await loadLibrary(supabase, user.id, prof ?? {});
  const existing = lib.resumes.find((r) => r.id === id);
  const fallbackLabel = id === "main" ? "Main resume" : parsed.target_roles?.[0] ? `${parsed.target_roles[0]} resume` : "Resume";
  const entry = { id, label: label || existing?.label || fallbackLabel, path, parsed: id === "main" ? null : parsed, uploaded_at: new Date().toISOString() };
  lib.resumes = existing ? lib.resumes.map((r) => (r.id === id ? entry : r)) : [...lib.resumes, entry];
  try {
    await saveLibrary(supabase, user.id, lib);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, saved: true }, { status: 500 });
  }
  const summary = { ok: true, id, label: entry.label, name: parsed.name, skills: parsed.skills?.length ?? 0, experience: parsed.experience?.length ?? 0, projects: parsed.projects?.length ?? 0, target_roles: parsed.target_roles ?? [] };
  if (id !== "main") {
    await logEvent(admin, { user_id: user.id, area: "resume", level: "info", message: `Resume "${entry.label}" read in ${Date.now() - t0} ms` });
    return NextResponse.json(summary);
  }

  const { data: current } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const keep = <T,>(existing: T | null | undefined, incoming: T | null | undefined) =>
    existing != null && (!(typeof existing === "string") || existing.trim()) && (!Array.isArray(existing) || existing.length) ? existing : incoming ?? null;
  const [first, ...rest] = (parsed.name ?? "").trim().split(/\s+/);
  const edu = parsed.education?.[0];
  // "Atlanta, GA" / "Atlanta, Georgia, USA" → city + state.
  const [city, state] = (parsed.location ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const url = (x?: string | null) => (x && /^https?:|\.(com|io|dev|me)\b/i.test(x) ? x : null);

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      resume_path: path,
      resume_parsed: parsed,
      resume_text: resumeToText(parsed),
      resume_updated_at: new Date().toISOString(),
      first_name: keep(current?.first_name, first || null),
      last_name: keep(current?.last_name, rest.join(" ") || null),
      full_name: keep(current?.full_name, parsed.name),
      job_email: keep(current?.job_email, parsed.email),
      phone: keep(current?.phone, parsed.phone),
      linkedin_url: keep(current?.linkedin_url, url(parsed.links?.linkedin)),
      github_url: keep(current?.github_url, url(parsed.links?.github)),
      website_url: keep(current?.website_url, url(parsed.links?.website)),
      city: keep(current?.city, city || null),
      state: keep(current?.state, state || null),
      school: keep(current?.school, edu?.school),
      graduation_date: keep(current?.graduation_date, edu?.graduation),
      skills: [...new Set([...(current?.skills ?? []), ...(parsed.skills ?? [])])],
      target_roles: keep(current?.target_roles, parsed.target_roles ?? []),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    await logEvent(admin, { user_id: user.id, area: "resume", level: "error", message: `Saving parsed resume failed: ${error.message}` });
    return NextResponse.json({ error: `Read your resume but couldn’t save it: ${error.message}` }, { status: 500 });
  }

  await supabase.from("evidence_bank").delete().eq("user_id", user.id).eq("proof", "resume");
  const evidence = evidenceFromResume(parsed).map((e) => ({ ...e, user_id: user.id, proof: "resume", approved: true }));
  if (evidence.length) await supabase.from("evidence_bank").insert(evidence);
  await logEvent(admin, { user_id: user.id, area: "resume", level: "info", message: `Resume read in ${Date.now() - t0} ms: ${parsed.skills?.length ?? 0} skills, ${parsed.experience?.length ?? 0} jobs` });

  return NextResponse.json(summary);
}

/**
 * GET /api/resume?id=<id>            → the uploaded PDF
 * GET /api/resume?id=<id>&preview=1  → what the agent sends: your layout, one page, keywords in bold
 */
export async function GET(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = params.get("id") ?? "main";
  if (!validId(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  if (params.get("preview")) {
    const { data: p } = await auth.supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
    const lib = await loadLibrary(auth.supabase, auth.user.id, p ?? {});
    const r = lib.resumes.find((x) => x.id === id)?.parsed;
    if (!r) return NextResponse.json({ error: "That resume hasn’t been read yet" }, { status: 404 });
    const pdf = await renderClassicResume(r, {
      name: r.name || p?.full_name || "",
      email: r.email || p?.job_email,
      phone: r.phone || p?.phone,
      location: r.location || [p?.city, p?.state].filter(Boolean).join(", "),
      linkedin: p?.linkedin_url,
      github: p?.github_url,
      website: p?.website_url,
      headline: r.headline,
    });
    if (!pdf) return NextResponse.json({ error: "This resume is longer than one page in the agent's layout, so the agent sends your original PDF unchanged." }, { status: 422 });
    return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=preview.pdf", "Cache-Control": "no-store" } });
  }
  const { data } = await auth.supabase.storage.from("resumes").createSignedUrl(resumeFilePath(auth.user.id, id), 60);
  if (!data?.signedUrl) return NextResponse.json({ error: "No resume uploaded" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}

/** Rename: JSON { id, label }. */
export async function PATCH(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; label?: string };
  const label = cleanLabel(body.label);
  if (!label) return NextResponse.json({ error: "Give it a name" }, { status: 400 });
  const { data: p } = await auth.supabase.from("profiles").select("resume_path,resume_parsed,resume_updated_at").eq("id", auth.user.id).maybeSingle();
  const lib = await loadLibrary(auth.supabase, auth.user.id, p ?? {});
  if (!lib.resumes.some((r) => r.id === body.id)) return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  lib.resumes = lib.resumes.map((r) => (r.id === body.id ? { ...r, label } : r));
  await saveLibrary(auth.supabase, auth.user.id, lib);
  return NextResponse.json({ ok: true });
}

/** Delete an extra resume: ?id=<id>. The main resume can be replaced, not deleted. */
export async function DELETE(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!validId(id) || id === "main") return NextResponse.json({ error: "The main resume can be replaced, not deleted" }, { status: 400 });
  const { data: p } = await auth.supabase.from("profiles").select("resume_path,resume_parsed,resume_updated_at").eq("id", auth.user.id).maybeSingle();
  const lib = await loadLibrary(auth.supabase, auth.user.id, p ?? {});
  lib.resumes = lib.resumes.filter((r) => r.id !== id);
  await auth.supabase.storage.from("resumes").remove([resumeFilePath(auth.user.id, id)]);
  await saveLibrary(auth.supabase, auth.user.id, lib);
  return NextResponse.json({ ok: true });
}
