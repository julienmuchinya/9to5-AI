import { NextResponse } from "next/server";
import { apiUser, serviceClient } from "@/lib/v2/session";
import { evidenceFromResume, parseResumePdf, resumeToText } from "@/lib/v2/resume";
import { FreeTierLimitError } from "@/lib/v2/gemini";
import { freeTierSnapshot } from "@/lib/v2/freeTier";
import { logEvent } from "@/lib/v2/log";

export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  const { supabase, user } = auth;
  const admin = serviceClient();
  const path = `${user.id}/resume.pdf`;
  const t0 = Date.now();

  const form = await req.formData().catch(() => null);
  const file = form?.get("resume");
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
    await supabase.from("profiles").upsert({ id: user.id, resume_path: path, resume_updated_at: new Date().toISOString() }, { onConflict: "id" });
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

  const { data: current } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const keep = <T,>(existing: T | null | undefined, incoming: T | null | undefined) =>
    existing != null && (!(typeof existing === "string") || existing.trim()) && (!Array.isArray(existing) || existing.length) ? existing : incoming ?? null;
  const [first, ...rest] = (parsed.name ?? "").trim().split(/s+/);
  const edu = parsed.education?.[0];

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
      linkedin_url: keep(current?.linkedin_url, parsed.links?.linkedin),
      github_url: keep(current?.github_url, parsed.links?.github),
      website_url: keep(current?.website_url, parsed.links?.website),
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

  return NextResponse.json({
    ok: true,
    name: parsed.name,
    skills: parsed.skills?.length ?? 0,
    experience: parsed.experience?.length ?? 0,
    projects: parsed.projects?.length ?? 0,
    target_roles: parsed.target_roles ?? [],
  });
}

/** Download your stored resume. */
export async function GET() {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data } = await auth.supabase.storage.from("resumes").createSignedUrl(`${auth.user.id}/resume.pdf`, 60);
  if (!data?.signedUrl) return NextResponse.json({ error: "No resume uploaded" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
