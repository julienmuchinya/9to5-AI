import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { geminiJson } from "./gemini";

export interface ParsedResume {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: { linkedin?: string; github?: string; website?: string };
  summary?: string;
  /** Short line under the contact details, e.g. "Open to Work Remotely | Hybrid or Relocate". */
  headline?: string;
  education?: { school: string; degree?: string; field?: string; graduation?: string; gpa?: string }[];
  /** Bullets may mark the resume's bold phrases with **double asterisks**. */
  experience?: { title: string; company: string; location?: string; start?: string; end?: string; url?: string | null; bullets: string[] }[];
  projects?: { name: string; role?: string; org?: string; date?: string; url?: string | null; tech?: string[]; bullets: string[] }[];
  skills?: string[];
  /** Skills as grouped on the resume ("Programming Languages & Frameworks": [...]). */
  skill_groups?: { name: string; items: string[] }[];
  certifications?: string[];
  awards?: string[];
  target_roles?: string[];
}

const PARSE_PROMPT = `Extract this resume into JSON with exactly these keys:
name, email, phone, location, headline (the short availability/tagline line near the contact details, e.g. "Open to Work Remotely | Hybrid or Relocate", else null),
links {linkedin, github, website} (the real URLs behind the links if visible, else the link text),
summary,
education [{school, degree, field, graduation, gpa}],
experience [{title, company, location, start, end, bullets[]}],
projects [{name, role, org, date, tech[], bullets[]}] (role = e.g. "Technical Specialist", org = e.g. the university, date = e.g. "Fall 2025"),
skills[] (individual skills, tools, technologies, licenses and certifications in any field, e.g. "Python", "Excel", "Phlebotomy", "Forklift", "QuickBooks", "CDL Class A"),
skill_groups [{name, items[]}] (the skill categories exactly as grouped on the resume; [] if not grouped),
certifications[], awards[],
target_roles[] (3-5 job titles this person is best suited for, in whatever field the resume is in, based ONLY on the resume).
In bullets, wrap every phrase that is bold on the resume in **double asterisks**.
Copy text faithfully. Never invent or embellish anything. Use null for missing fields.`;

/** Read a resume PDF with Gemini (free tier). */
export async function parseResumePdf(db: SupabaseClient, pdf: Buffer, userId: string): Promise<ParsedResume> {
  return geminiJson<ParsedResume>(
    db,
    PARSE_PROMPT,
    [{ inlineData: { mimeType: "application/pdf", data: pdf.toString("base64") } }],
    userId
  );
}

const plain = (s: string) => s.replace(/\*\*/g, "");

export function resumeToText(r: ParsedResume): string {
  const lines: string[] = [];
  if (r.summary) lines.push(r.summary);
  for (const e of r.experience ?? []) lines.push(`${e.title} at ${e.company}: ${plain(e.bullets.join(" "))}`);
  for (const p of r.projects ?? []) lines.push(`${p.name} (${(p.tech ?? []).join(", ")}): ${plain(p.bullets.join(" "))}`);
  for (const e of r.education ?? []) lines.push(`${e.degree ?? ""} ${e.field ?? ""}, ${e.school} ${e.graduation ?? ""}`);
  if (r.skills?.length) lines.push(`Skills: ${r.skills.join(", ")}`);
  return lines.join("\n");
}

/** Evidence items (true facts) built from the resume, for the evidence bank. */
export function evidenceFromResume(r: ParsedResume) {
  const items: { category: string; title: string; content: string; skills: string[] }[] = [];
  for (const e of r.experience ?? [])
    for (const b of e.bullets) items.push({ category: "experience", title: `${e.title} — ${e.company}`, content: plain(b), skills: [] });
  for (const p of r.projects ?? [])
    for (const b of p.bullets) items.push({ category: "project", title: p.name, content: plain(b), skills: p.tech ?? [] });
  for (const a of r.awards ?? []) items.push({ category: "award", title: a, content: a, skills: [] });
  for (const c of r.certifications ?? []) items.push({ category: "certification", title: c, content: c, skills: [] });
  return items;
}

// ── Tailored resume PDF ────────────────────────────────────────────────────
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9+#.]{2,}/g) ?? []);
function relevance(text: string, jobWords: Set<string>): number {
  let n = 0;
  for (const w of words(text)) if (jobWords.has(w)) n++;
  return n;
}

/** Reorders (never rewrites) the real resume so the most relevant content comes first. */
export function tailorResume(r: ParsedResume, jobText: string): ParsedResume {
  const jw = words(jobText);
  const byRel = <T,>(arr: T[], text: (t: T) => string) =>
    [...arr].map((x, i) => ({ x, i, s: relevance(text(x), jw) })).sort((a, b) => b.s - a.s || a.i - b.i).map((o) => o.x);
  return {
    ...r,
    skills: byRel(r.skills ?? [], (s) => s),
    skill_groups: r.skill_groups?.map((g) => ({ ...g, items: byRel(g.items, (s) => s) })),
    experience: (r.experience ?? []).map((e) => ({ ...e, bullets: byRel(e.bullets, (b) => b) })),
    projects: byRel(r.projects ?? [], (p) => `${p.name} ${(p.tech ?? []).join(" ")} ${p.bullets.join(" ")}`).map((p) => ({
      ...p,
      bullets: byRel(p.bullets, (b) => b),
    })),
  };
}

// pdf-lib's standard fonts only cover WinAnsi; replace anything else.
const safe = (s: string) =>
  (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function renderResumePdf(r: ParsedResume): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  let page = doc.addPage([612, 792]);
  let y = 792 - margin;
  const width = 612 - margin * 2;

  const ensure = (h: number) => {
    if (y - h < margin) {
      page = doc.addPage([612, 792]);
      y = 792 - margin;
    }
  };
  const wrap = (text: string, font: PDFFont, size: number, maxW: number) => {
    const out: string[] = [];
    let line = "";
    for (const w of safe(text).split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxW && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  const write = (text: string, opts: { font?: PDFFont; size?: number; indent?: number; color?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    for (const l of wrap(text, font, size, width - indent)) {
      ensure(size + 3);
      page.drawText(l, { x: margin + indent, y: y - size, size, font, color: rgb(opts.color ?? 0.1, opts.color ?? 0.1, opts.color ?? 0.1) });
      y -= size + 3;
    }
  };
  const section = (title: string) => {
    y -= 6;
    ensure(18);
    write(title.toUpperCase(), { font: bold, size: 11 });
    page.drawLine({ start: { x: margin, y: y + 1 }, end: { x: margin + width, y: y + 1 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
    y -= 4;
  };

  write(r.name ?? "", { font: bold, size: 18 });
  const contact = [r.email, r.phone, r.location, r.links?.linkedin, r.links?.github, r.links?.website].filter(Boolean).join("  |  ");
  if (contact) write(contact, { size: 9, color: 0.3 });
  if (r.summary) {
    section("Summary");
    write(r.summary);
  }
  if (r.skills?.length) {
    section("Skills");
    write(r.skills.join(", "));
  }
  if (r.experience?.length) {
    section("Experience");
    for (const e of r.experience) {
      write(`${e.title} - ${e.company}${e.location ? `, ${e.location}` : ""}`, { font: bold });
      if (e.start || e.end) write(`${e.start ?? ""} - ${e.end ?? "Present"}`, { size: 9, color: 0.35 });
      for (const b of e.bullets) write(`- ${b}`, { indent: 10 });
      y -= 3;
    }
  }
  if (r.projects?.length) {
    section("Projects");
    for (const p of r.projects) {
      write(`${p.name}${p.tech?.length ? ` (${p.tech.join(", ")})` : ""}`, { font: bold });
      for (const b of p.bullets) write(`- ${b}`, { indent: 10 });
      y -= 3;
    }
  }
  if (r.education?.length) {
    section("Education");
    for (const e of r.education)
      write(`${[e.degree, e.field].filter(Boolean).join(" in ")} - ${e.school}${e.graduation ? ` (${e.graduation})` : ""}${e.gpa ? `, GPA ${e.gpa}` : ""}`);
  }
  const extras = [...(r.certifications ?? []), ...(r.awards ?? [])];
  if (extras.length) {
    section("Certifications & Awards");
    for (const x of extras) write(`- ${x}`);
  }
  return doc.save();
}
