import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, type PDFObject } from "pdf-lib";

/**
 * Plain text of a PDF, without any AI and with no extra dependency (pdf-lib only). Good enough for resumes exported
 * from Word / Google Docs / LaTeX: it reads each page's text operators and maps glyphs back to letters through the
 * fonts' ToUnicode tables. Used when Gemini (which reads the PDF itself) is out, so the backup AI can parse the text.
 */
export async function pdfText(bytes: Uint8Array | Buffer): Promise<string> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const fonts = new Map<string, CMap | null>();
    const res = page.node.Resources();
    const fontDict = res?.lookup(PDFName.of("Font"));
    if (fontDict instanceof PDFDict)
      for (const [name, ref] of fontDict.entries()) {
        const font = doc.context.lookup(ref);
        fonts.set(name.asString().replace(/^\//, ""), font instanceof PDFDict ? toUnicode(doc, font) : null);
      }
    const contents = page.node.Contents();
    const streams: PDFRawStream[] = [];
    if (contents instanceof PDFArray) for (const r of contents.asArray()) pushStream(doc, r, streams);
    else if (contents) pushStream(doc, contents, streams);
    const data = streams.map((s) => latin1(decodePDFRawStream(s).decode())).join("\n");
    out.push(readContent(data, fonts));
  }
  return out
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pushStream(doc: PDFDocument, o: PDFObject, into: PDFRawStream[]) {
  const s = o instanceof PDFRef ? doc.context.lookup(o) : o;
  if (s instanceof PDFRawStream) into.push(s);
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

interface CMap {
  bytes: number;
  map: Map<number, string>;
}

/** A font's ToUnicode table: glyph code → text. */
function toUnicode(doc: PDFDocument, font: PDFDict): CMap | null {
  const ref = font.get(PDFName.of("ToUnicode"));
  const s = ref ? doc.context.lookup(ref) : null;
  if (!(s instanceof PDFRawStream)) return null;
  const txt = latin1(decodePDFRawStream(s).decode());
  const map = new Map<number, string>();
  const hexStr = (h: string) => {
    let r = "";
    for (let i = 0; i + 4 <= h.length; i += 4) r += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    if (h.length % 4 === 2) r += String.fromCharCode(parseInt(h.slice(-2), 16));
    return r;
  };
  const space = txt.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
  const bytes = space ? Math.max(1, space[1].length / 2) : 2;
  for (const block of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexStr(m[2]));
  for (const block of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi - lo > 5000) continue;
      if (m[3].startsWith("[")) {
        const list = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => hexStr(x[1]));
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
      } else {
        const start = hexStr(m[3].slice(1, -1));
        const base = start.charCodeAt(start.length - 1);
        for (let c = lo; c <= hi; c++) map.set(c, start.slice(0, -1) + String.fromCharCode(base + (c - lo)));
      }
    }
  return { bytes, map };
}

/** Raw bytes of a PDF string token → text through the current font. */
function decodeString(raw: string, cmap: CMap | null): string {
  if (!cmap) return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  let s = "";
  for (let i = 0; i + cmap.bytes <= raw.length; i += cmap.bytes) {
    let code = 0;
    for (let k = 0; k < cmap.bytes; k++) code = (code << 8) | raw.charCodeAt(i + k);
    s += cmap.map.get(code) ?? (cmap.bytes === 1 ? raw[i] : "");
  }
  return s;
}

/** Literal "(…)" string body → raw bytes (escapes resolved). */
function literal(body: string): string {
  return body.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e: string) => {
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[e] ?? "";
  });
}

/** Walks a content stream: Tf picks the font, Tj/TJ/'/" show text, moves start new lines. */
function readContent(data: string, fonts: Map<string, CMap | null>): string {
  let font: CMap | null = null;
  let out = "";
  let lastY: number | null = null;
  const stack: string[] = [];
  const re = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|\[|\]|\/[^\s/<>[\]()]+|-?\d*\.?\d+|[A-Za-z'"*]+/g;
  let arr: { str?: string; num?: number }[] | null = null;
  let depth = 0;
  for (const m of data.matchAll(re)) {
    const t = m[0];
    // Nested parentheses inside a literal are rare in resumes; the regex handles escaped ones.
    if (t === "[") {
      arr = [];
      depth++;
      continue;
    }
    if (t === "]") {
      depth--;
      stack.push("__ARRAY__");
      continue;
    }
    const str = t.startsWith("(") ? literal(t.slice(1, -1)) : t.startsWith("<") && !t.startsWith("<<") ? hexBytes(t.slice(1, -1)) : null;
    if (arr && depth > 0) {
      if (str != null) arr.push({ str });
      else if (/^-?\d*\.?\d+$/.test(t)) arr.push({ num: Number(t) });
      continue;
    }
    if (str != null) {
      stack.push(`S${str}`);
      continue;
    }
    if (/^-?\d*\.?\d+$/.test(t) || t.startsWith("/")) {
      stack.push(t);
      continue;
    }
    switch (t) {
      case "Tf": {
        const name = stack[stack.length - 2]?.replace(/^\//, "");
        if (name && fonts.has(name)) font = fonts.get(name) ?? null;
        break;
      }
      case "Tj":
      case "'":
      case '"': {
        const s = [...stack].reverse().find((x) => x.startsWith("S"));
        if (t !== "Tj") out += "\n";
        if (s) out += decodeString(s.slice(1), font);
        break;
      }
      case "TJ":
        for (const part of arr ?? []) {
          if (part.str != null) out += decodeString(part.str, font);
          else if ((part.num ?? 0) < -180 && !out.endsWith(" ")) out += " ";
        }
        arr = null;
        break;
      case "Td":
      case "TD": {
        const ty = Number(stack[stack.length - 1]);
        if (ty !== 0 && !Number.isNaN(ty)) out += "\n";
        else if (!out.endsWith(" ")) out += " ";
        break;
      }
      case "Tm": {
        const y = Number(stack[stack.length - 1]);
        if (lastY != null && Math.abs(y - lastY) > 1) out += "\n";
        else if (!out.endsWith(" ")) out += " ";
        lastY = y;
        break;
      }
      case "T*":
        out += "\n";
        break;
      case "ET":
        if (!out.endsWith("\n")) out += " ";
        break;
    }
    stack.length = 0;
  }
  return out;
}

function hexBytes(h: string): string {
  const c = h.replace(/\s+/g, "");
  let s = "";
  for (let i = 0; i < c.length; i += 2) s += String.fromCharCode(parseInt(c.slice(i, i + 2).padEnd(2, "0"), 16));
  return s;
}
