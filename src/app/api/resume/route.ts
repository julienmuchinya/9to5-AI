import { NextResponse } from "next/server";
import { apiUser, serviceClient } from "@/lib/v2/session";
import { evidenceFromResume, parseResumePdf, resumeToText } from "@/lib/v2/resume";
import { FreeTierLimitError } from "@/lib/v2/gemini";
import { freeTierSnapshot } from "@/lib/v2/freeTier";

export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, user } = auth;

  const form = await req.formData();
  const file = form.get("resume");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.type !== "application/pdf") return NextResponse.json({ error: "Please upload a PDF" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "PDF must be under 5 MB" }, { status: 400 });

  const admin = serviceClient();
  const limits = await freeTierSnapshot(admin);
  if (!limits.storage.allowed) return NextResponse.json({ error: limits.storage.reason }, { status: 429 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const path = `${user.id}/resume.pdf`;
  const up = await supabase.storage.from("resumes").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 });

  let parsed;
  try {
    parsed = await parseResumePdf(admin, bytes, user.id);
  } catch (e) {
    const status = e instanceof FreeTierLimitError ? 429 : 502;
    return NextResponse.json({ error: `Saved your PDF, but couldn't read it: ${(e as Error).message}` }, { status });
  }

  const { data: current } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  const keep = <T,>(existing: T | null | undefined, incoming: T | null | undefined) =>
    existing != null && (!(typeof existing === "string") || existing.trim()) && (!Array.isArray(existing) || existing.length) ? existing : incoming ?? null;
  const [first, ...rest] = (parsed.name ?? "").trim().split(/\s+/);
  const edu = parsed.education?.[0];

  const { error } = await supabase
    .from("profiles")
    .update({
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
      school: edu?.school ?? current?.school ?? null,
      graduation_date: keep(current?.graduation_date, edu?.graduation),
      skills: [...new Set([...(current?.skills ?? []), ...(parsed.skills ?? [])])],
      target_roles: keep(current?.target_roles, parsed.target_roles ?? []),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("evidence_bank").delete().eq("user_id", user.id).eq("proof", "resume");
  const evidence = evidenceFromResume(parsed).map((e) => ({ ...e, user_id: user.id, proof: "resume", approved: true }));
  if (evidence.length) await supabase.from("evidence_bank").insert(evidence);

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
