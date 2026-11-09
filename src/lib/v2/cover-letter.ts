import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { geminiJson } from "./gemini";

/**
 * A short cover letter, only for forms that REQUIRE one (an empty required cover-letter upload used to
 * stop the application). Written from the resume and the job description with the free backup AI
 * (never Gemini), then laid out as a one-page PDF.
 */
export async function writeCoverLetter(
  db: SupabaseClient,
  ctx: { name: string; email?: string | null; phone?: string | null; company: string; title: string; resume: string; jobDescription: string; userId?: string }
): Promise<string> {
  const prompt = `Write a concise, specific cover letter (3 short paragraphs, under 230 words) from ${ctx.name} for "${ctx.title}" at ${ctx.company}.
Use ONLY facts from the resume — never invent employers, numbers, degrees or skills. Mirror 2-3 priorities from the job description.
No placeholders, no date, no address block, no "Dear Hiring Manager" header, no sign-off (those are added separately).
RESUME: ${ctx.resume.replace(/\s+/g, " ").slice(0, 3500)}
JOB DESCRIPTION: ${ctx.jobDescription.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2000)}
Return JSON: {"body": "<paragraph 1>\\n\\n<paragraph 2>\\n\\n<paragraph 3>"}`;
  const out = await geminiJson<{ body?: string }>(db, prompt, [], ctx.userId, { prefer: "fallback-only", maxTokens: 900 });
  const body = (out.body ?? "").replace(/\r/g, "").trim();
  if (body.length < 200) throw new Error("cover letter came back empty");
  return body;
}

const winAnsi = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑‒–—]/g, "-").replace(/ /g, " ").replace(/…/g, "...").replace(/[^\x20-\x7E\n]/g, "");

/** One-page PDF: name and contact on top, "Dear Hiring Team at X,", the body, sign-off. */
export async function coverLetterPdf(ctx: { name: string; email?: string | null; phone?: string | null; company: string }, body: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const left = 72;
  const width = 612 - 2 * left;
  let y = 720;
  page.drawText(winAnsi(ctx.name), { x: left, y, size: 16, font: bold });
  y -= 18;
  const contact = [ctx.email, ctx.phone].filter(Boolean).join("  |  ");
  if (contact) page.drawText(winAnsi(contact), { x: left, y, size: 10.5, font });
  y -= 40;
  const lines: string[] = [`Dear Hiring Team at ${ctx.company},`, "", ...body.split(/\n\s*\n/).flatMap((p) => [p.trim(), ""]), "Sincerely,", ctx.name];
  const size = 11.5;
  for (const para of lines) {
    if (!para) {
      y -= size * 0.9;
      continue;
    }
    let line = "";
    for (const word of winAnsi(para).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width) {
        page.drawText(line, { x: left, y, size, font });
        y -= size * 1.35;
        line = word;
      } else line = next;
    }
    if (line) {
      page.drawText(line, { x: left, y, size, font });
      y -= size * 1.35;
    }
    if (y < 72) break;
  }
  return pdf.save();
}
