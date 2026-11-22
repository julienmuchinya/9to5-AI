import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ParsedResume } from "./resume";

/**
 * Renders a resume in the applicant's own layout ("classic"): Times, a two-column centred header,
 * bold caps section titles with a rule, teal underlined company/project names, italic titles with
 * right-aligned dates, round bullets and **bold** key phrases. Always one page: the text size steps
 * down until everything fits; if it still doesn't fit at the smallest size, returns null and the
 * caller uploads the original PDF instead.
 */

export interface ResumeContact {
  name: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedin?: string | null;
  github?: string | null;
  website?: string | null;
  headline?: string | null;
}

const W = 612;
const H = 792;
const MX = 36; // side margins (pt)
const MT = 40;
const MB = 30;
const TEAL = rgb(0.27, 0.47, 0.55);
const BLACK = rgb(0, 0, 0);

// Times (WinAnsi) covers curly quotes, dashes and bullets; replace anything else.
const WIN_EXTRA = "“”‘’–—•…€™";
export const winAnsi = (s: string) =>
  [...(s ?? "")
    .replace(/[\u2010\u2011\u2012\u2043\u2212]/g, "-")
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f]/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[\u2032\u02bc]/g, "'")]
    .map((c) => (c === "\t" || c === "\n" ? " " : c))
    .filter((c) => (c >= " " && c <= "~") || (c >= " " && c <= "ÿ") || WIN_EXTRA.includes(c))
    .join("");

type Run = { text: string; bold: boolean };
/** "Did **this** and that" → runs; unmatched ** are dropped. */
export function boldRuns(s: string): Run[] {
  const out: Run[] = [];
  const parts = winAnsi(s).split("**");
  const balanced = parts.length % 2 === 1;
  parts.forEach((p, i) => p && out.push({ text: p, bold: balanced && i % 2 === 1 }));
  return out.length ? out : [{ text: "", bold: false }];
}

interface Fonts {
  r: PDFFont;
  b: PDFFont;
  i: PDFFont;
  bi: PDFFont;
}

function linkAnnot(doc: PDFDocument, page: PDFPage, x: number, y: number, w: number, h: number, url: string) {
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  const ref = doc.context.register(annot);
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing && "push" in existing) (existing as unknown as { push: (r: unknown) => void }).push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}

/** Draws one resume at a given body size. Returns false when it overflowed the page. */
async function draw(doc: PDFDocument, f: Fonts, r: ParsedResume, c: ResumeContact, size: number): Promise<boolean> {
  const page = doc.addPage([W, H]);
  const lh = size * 1.2;
  let y = H - MT;
  let overflow = false;
  const right = W - MX;
  const width = right - MX;
  const down = (h: number) => {
    y -= h;
    if (y < MB) overflow = true;
  };
  const text = (s: string, x: number, font: PDFFont, sz = size, color = BLACK) => {
    if (!overflow) page.drawText(winAnsi(s), { x, y, size: sz, font, color });
  };
  const tw = (s: string, font: PDFFont, sz = size) => font.widthOfTextAtSize(winAnsi(s), sz);
  /** The largest size (down to 85%) at which `s` fits in `maxW`; text that still doesn't fit is shortened with "…". */
  const fit = (s: string, font: PDFFont, maxW: number, sz = size): { s: string; sz: number } => {
    for (let k = sz; k >= sz * 0.85; k -= 0.25) if (tw(s, font, k) <= maxW) return { s, sz: k };
    const min = sz * 0.85;
    let cut = s;
    while (cut.length > 4 && tw(`${cut}…`, font, min) > maxW) cut = cut.slice(0, -1);
    return { s: `${cut.trimEnd()}…`, sz: min };
  };
  const centered = (s: string, cx: number, font: PDFFont, sz = size, color = BLACK, maxW = width) => {
    const t = fit(s, font, maxW, sz);
    text(t.s, cx - tw(t.s, font, t.sz) / 2, font, t.sz, color);
  };
  const underline = (x: number, w: number, color = BLACK) => page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + w, y: y - 1.5 }, thickness: 0.6, color });
  const rule = (thick = 0.8) => page.drawLine({ start: { x: MX, y }, end: { x: right, y }, thickness: thick, color: BLACK });

  /** Word-wrap mixed bold/regular runs into the box [x0, x1]. */
  const paragraph = (runs: Run[], x0: number, x1: number, regular = f.r, bold = f.b) => {
    // Tokens remember whether a space preceded them, so "**workflows**, achieving" keeps the comma tight.
    const words: { w: string; font: PDFFont; sp: boolean }[] = [];
    let pendingSpace = false;
    for (const run of runs)
      for (const piece of run.text.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) {
          pendingSpace = true;
          continue;
        }
        words.push({ w: piece, font: run.bold ? bold : regular, sp: pendingSpace && words.length > 0 });
        pendingSpace = false;
      }
    let line: { w: string; font: PDFFont; sp: boolean }[] = [];
    let lineW = 0;
    const space = tw(" ", regular);
    // Same-font stretches are drawn as one string with real spaces: ATS parsers read the text layer.
    const flush = () => {
      let x = x0;
      let seg = "";
      let segFont: PDFFont | null = null;
      const out = () => {
        if (seg && segFont) {
          text(seg, x, segFont);
          x += tw(seg, segFont);
        }
        seg = "";
      };
      line.forEach((t, i) => {
        if (t.font !== segFont) {
          out();
          segFont = t.font;
        }
        seg += (i > 0 && t.sp ? " " : "") + t.w;
      });
      out();
      down(lh);
      line = [];
      lineW = 0;
    };
    for (const t of words) {
      const ww = tw(t.w, t.font);
      const gap = line.length && t.sp ? space : 0;
      if (line.length && lineW + gap + ww > x1 - x0) flush();
      lineW += (line.length && t.sp ? space : 0) + ww;
      line.push(t);
    }
    if (line.length) flush();
  };
  const bullet = (s: string) => {
    text("•", MX + 42, f.r);
    paragraph(boldRuns(s), MX + 58, right);
  };
  const section = (title: string) => {
    down(lh * 0.55);
    text(title.toUpperCase(), MX, f.b, size);
    down(size * 0.35);
    rule();
    down(lh * 1.05);
  };
  /** "Left bold-teal-underlined ....... right regular" line. */
  const leftRight = (left: string, leftFont: PDFFont, leftColor: ReturnType<typeof rgb>, rightText: string, rightFont: PDFFont, ul = false, href?: string | null) => {
    const rw = rightText ? tw(rightText, rightFont) : 0;
    const l = fit(left, leftFont, width - rw - (rightText ? 14 : 0));
    text(l.s, MX, leftFont, l.sz, leftColor);
    const lw = tw(l.s, leftFont, l.sz);
    if (ul) underline(MX, lw, leftColor);
    if (href && !overflow) linkAnnot(doc, page, MX, y - 2, lw, size + 2, href);
    if (rightText) text(rightText, right - rw, rightFont);
    down(lh);
  };

  // ── Header: two centred columns ──
  const lc = MX + width * 0.27;
  const rc = MX + width * 0.77;
  const top = y;
  const half = width / 2 - 10;
  centered(c.name, lc, f.b, size + 0.5, BLACK, half);
  down(lh);
  if (c.email) {
    centered(c.email, lc, f.i, size, BLACK, half);
    down(lh);
  }
  if (c.phone) {
    centered(c.phone, lc, f.r, size, BLACK, half);
    down(lh);
  }
  const leftBottom = y;
  y = top;
  const links = [c.linkedin ? { t: "My LinkedIn", u: c.linkedin } : null, c.github ? { t: "My GitHub", u: c.github } : null, c.website ? { t: "My Website", u: c.website } : null].filter(
    (x): x is { t: string; u: string } => Boolean(x)
  );
  if (links.length) {
    const sep = " | ";
    const total = links.reduce((n, l) => n + tw(l.t, f.r), 0) + tw(sep, f.r) * (links.length - 1);
    let x = rc - total / 2;
    links.forEach((l, i) => {
      text(l.t, x, f.r, size, TEAL);
      underline(x, tw(l.t, f.r), TEAL);
      if (!overflow) linkAnnot(doc, page, x, y - 2, tw(l.t, f.r), size + 2, /^https?:/.test(l.u) ? l.u : `https://${l.u}`);
      x += tw(l.t, f.r);
      if (i < links.length - 1) {
        text(sep, x, f.r);
        x += tw(sep, f.r);
      }
    });
    down(lh);
  }
  if (c.location) {
    centered(c.location, rc, f.i, size, BLACK, half);
    down(lh);
  }
  if (c.headline) {
    centered(c.headline, rc, f.r, size, BLACK, half);
    down(lh);
  }
  y = Math.min(y, leftBottom);

  // ── Education: degrees side by side, two per row ──
  const edu = r.education ?? [];
  if (edu.length) {
    section("Education");
    const degreeOf = (e: (typeof edu)[number]) => [e.degree, e.field].filter(Boolean).join(" in ");
    const schoolLine = (e: (typeof edu)[number]) => {
      // The resume's own date may already say "Expected: Dec 2026" — no "Graduation: Expected: Dec 2026".
      const date = (e.graduation ?? "").replace(/^\s*(expected|anticipated|planned|est\.?|estimated)?\s*(graduation)?\s*(date)?\s*[:\-–]?\s*/i, "").trim();
      const said = /expected|anticipated|planned|estimated/i.test(e.graduation ?? "");
      const year = Number(date.match(/(\d{4})/)?.[1] ?? 0);
      const future = said || year > new Date().getFullYear() || (year === new Date().getFullYear() && !/jan|feb|mar|apr|may/i.test(date));
      return `${e.school}${date ? ` | ${future ? "Expected Graduation" : "Graduation"}: ${date}` : ""}${e.gpa ? ` | GPA ${e.gpa}` : ""}`;
    };
    // Side by side the two columns are ~265 pt wide; longer lines collided in the middle ("letters running into
    // each other"), so a pair that doesn't fit goes one per row instead.
    const colW = width / 2 - 12;
    const pairFits = (row: typeof edu) => row.every((e) => tw(degreeOf(e), f.b) <= colW && tw(schoolLine(e), f.i) <= colW);
    for (let i = 0; i < edu.length; ) {
      const row = edu.length - i >= 2 && pairFits(edu.slice(i, i + 2)) ? edu.slice(i, i + 2) : edu.slice(i, i + 1);
      i += row.length;
      const cols = row.length === 1 ? [MX + width / 2] : [MX + width * 0.25, MX + width * 0.75];
      const maxW = row.length === 1 ? width : colW;
      row.forEach((e, k) => {
        const t = fit(degreeOf(e), f.b, maxW);
        centered(t.s, cols[k], f.b, t.sz, BLACK, maxW);
        const w = tw(t.s, f.b, t.sz);
        underline(cols[k] - w / 2, w);
      });
      down(lh);
      row.forEach((e, k) => centered(schoolLine(e), cols[k], f.i, size, BLACK, maxW));
      down(lh * 1.15);
    }
  }

  // ── Experience ──
  const exp = r.experience ?? [];
  if (exp.length) {
    section("Professional Experience");
    exp.forEach((e, i) => {
      if (i > 0) {
        down(lh * 0.2);
        rule(0.6);
        down(lh * 1.1);
      }
      leftRight(e.company, f.b, TEAL, e.location ?? "", f.r, true, e.url ?? null);
      leftRight(e.title, f.i, BLACK, [e.start, e.end].filter(Boolean).join(" – "), f.i);
      for (const b of e.bullets) bullet(b);
    });
  }

  // ── Skills ──
  const groups = r.skill_groups?.length ? r.skill_groups : r.skills?.length ? [{ name: "", items: r.skills }] : [];
  if (groups.length) {
    section("Skills");
    down(lh * 0.3);
    for (const g of groups) {
      text("•", MX + 42, f.r);
      if (g.name) {
        text(`${g.name}:`, MX + 58, f.b);
        down(lh);
      }
      paragraph([{ text: g.items.join(", "), bold: false }], MX + 58, right);
    }
  }

  // ── Projects ──
  const projects = r.projects ?? [];
  if (projects.length) {
    section("Projects");
    for (const p of projects) {
      leftRight(p.name, f.b, TEAL, p.org ?? "", f.i, true, p.url ?? null);
      const role = p.role ?? "";
      const tech = p.tech?.length ? `${role ? " " : ""}(${p.tech.join(", ")})` : "";
      const dateW = p.date ? tw(p.date, f.r) + 14 : 0;
      const r1 = fit(role, f.bi, width - dateW);
      text(r1.s, MX, f.bi, r1.sz);
      const used = tw(r1.s, f.bi, r1.sz);
      if (tech) {
        const t1 = fit(tech, f.i, Math.max(40, width - dateW - used));
        text(t1.s, MX + used, f.i, t1.sz);
      }
      if (p.date) text(p.date, right - tw(p.date, f.r), f.r);
      down(lh);
      for (const b of p.bullets) bullet(b);
      down(lh * 0.3);
    }
  }

  const extras = [...(r.certifications ?? []), ...(r.awards ?? [])];
  if (extras.length) {
    section("Certifications & Awards");
    for (const x of extras) bullet(x);
  }
  return !overflow;
}

/** One-page PDF in the applicant's layout, or null if it can't fit on one page. */
export async function renderClassicResume(r: ParsedResume, contact: ResumeContact): Promise<Uint8Array | null> {
  // Stepping down to 9 pt squeezed everything together and looked machine-made; below 10 pt the caller sends
  // the applicant's original PDF instead.
  for (const size of [11, 10.5, 10]) {
    const doc = await PDFDocument.create();
    doc.setTitle(`${contact.name} Resume`);
    doc.setAuthor(contact.name);
    const fonts: Fonts = {
      r: await doc.embedFont(StandardFonts.TimesRoman),
      b: await doc.embedFont(StandardFonts.TimesRomanBold),
      i: await doc.embedFont(StandardFonts.TimesRomanItalic),
      bi: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    };
    if (await draw(doc, fonts, r, contact, size)) return doc.save();
  }
  return null;
}
