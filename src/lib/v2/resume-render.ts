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
  [...(s ?? "")]
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
  const centered = (s: string, cx: number, font: PDFFont, sz = size, color = BLACK) => text(s, cx - tw(s, font, sz) / 2, font, sz, color);
  const underline = (x: number, w: number, color = BLACK) => page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + w, y: y - 1.5 }, thickness: 0.6, color });
  const rule = (thick = 0.8) => page.drawLine({ start: { x: MX, y }, end: { x: right, y }, thickness: thick, color: BLACK });

  /** Word-wrap mixed bold/regular runs into the box [x0, x1]. */
  const paragraph = (runs: Run[], x0: number, x1: number, regular = f.r, bold = f.b) => {
    const words: { w: string; font: PDFFont }[] = [];
    for (const run of runs) for (const w of run.text.split(/(\s+)/).filter((t) => t && !/^\s+$/.test(t))) words.push({ w, font: run.bold ? bold : regular });
    let line: { w: string; font: PDFFont }[] = [];
    let lineW = 0;
    const space = tw(" ", regular);
    const flush = () => {
      let x = x0;
      for (const t of line) {
        text(t.w, x, t.font);
        x += tw(t.w, t.font) + space;
      }
      down(lh);
      line = [];
      lineW = 0;
    };
    for (const t of words) {
      const ww = tw(t.w, t.font);
      if (line.length && lineW + space + ww > x1 - x0) flush();
      lineW += (line.length ? space : 0) + ww;
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
    text(left, MX, leftFont, size, leftColor);
    if (ul) underline(MX, tw(left, leftFont), leftColor);
    if (href && !overflow) linkAnnot(doc, page, MX, y - 2, tw(left, leftFont), size + 2, href);
    if (rightText) text(rightText, right - tw(rightText, rightFont), rightFont);
    down(lh);
  };

  // ── Header: two centred columns ──
  const lc = MX + width * 0.27;
  const rc = MX + width * 0.77;
  const top = y;
  centered(c.name, lc, f.b, size + 0.5);
  down(lh);
  if (c.email) {
    centered(c.email, lc, f.i);
    down(lh);
  }
  if (c.phone) {
    centered(c.phone, lc, f.r);
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
    centered(c.location, rc, f.i);
    down(lh);
  }
  if (c.headline) {
    centered(c.headline, rc, f.r);
    down(lh);
  }
  y = Math.min(y, leftBottom);

  // ── Education: degrees side by side, two per row ──
  const edu = r.education ?? [];
  if (edu.length) {
    section("Education");
    for (let i = 0; i < edu.length; i += 2) {
      const row = edu.slice(i, i + 2);
      const cols = row.length === 1 ? [MX + width / 2] : [MX + width * 0.27, MX + width * 0.75];
      row.forEach((e, k) => {
        const deg = [e.degree, e.field].filter(Boolean).join(" in ");
        centered(deg, cols[k], f.b);
        const w = tw(deg, f.b);
        underline(cols[k] - w / 2, w);
      });
      down(lh);
      row.forEach((e, k) => {
        const future = e.graduation && /(\d{4})/.test(e.graduation) && Number(e.graduation.match(/(\d{4})/)![1]) > new Date().getFullYear();
        const line = `${e.school}${e.graduation ? ` | ${future ? "Expected Graduation" : "Graduation"}: ${e.graduation}` : ""}${e.gpa ? ` | GPA ${e.gpa}` : ""}`;
        centered(line, cols[k], f.i);
      });
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
      text(role, MX, f.bi);
      text(tech, MX + tw(role, f.bi), f.i);
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
  for (const size of [11, 10.5, 10, 9.5, 9]) {
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
