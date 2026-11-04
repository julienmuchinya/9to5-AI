export type JobLevel = "internship" | "new_grad" | "entry" | "mid" | "senior";

const STEM = new RegExp(
  [
    "engineer", "engineering", "developer", "software", "programmer", "swe\\b", "sde\\b",
    "data (scientist|analyst|engineer)", "machine learning", "\\bml\\b", "\\bai\\b", "artificial intelligence",
    "deep learning", "computer vision", "\\bnlp\\b", "research scientist", "applied scientist",
    "security", "cyber", "cloud", "devops", "\\bsre\\b", "site reliability", "infrastructure",
    "platform", "backend", "back-end", "frontend", "front-end", "full[- ]?stack", "mobile", "ios", "android",
    "\\bqa\\b", "quality assurance", "test automation", "network", "systems", "database", "\\bdba\\b",
    "\\bit\\b", "information technology", "technical support engineer", "solutions architect",
    "hardware", "firmware", "embedded", "fpga", "asic", "electrical", "mechanical", "robotics",
    "aerospace", "chemical", "biomedical", "civil engineer", "industrial engineer", "manufacturing engineer",
    "quantitative", "quant\\b", "actuar", "statistic", "bioinformatics", "mathemat", "physicist", "physics",
    "analytics", "business intelligence", "\\bbi\\b", "scientist", "technologist", "computational",
  ].join("|"),
  "i"
);
const NOT_STEM =
  /\b(sales|account executive|account manager|recruit|talent|marketing|customer success|people partner|human resources|\bhr\b|legal|counsel|paralegal|attorney|copywriter|social media|executive assistant|office manager|nurse|barista|driver|warehouse)\b/i;

export function isStemTitle(title: string): boolean {
  return STEM.test(title) && !NOT_STEM.test(title);
}

export function detectLevel(title: string, extra = ""): JobLevel {
  const t = `${title} ${extra}`;
  if (/\bintern(ship)?\b|\bco-?op\b|summer (19|20)\d\d|\bapprentice/i.test(t)) return "internship";
  if (/new grad|new graduate|university grad|recent grad|early career|campus|graduate (program|engineer|developer)|class of 20/i.test(t))
    return "new_grad";
  if (/\b(senior|sr\.?|staff|principal|lead|manager|director|head of|architect|vp)\b|\b(ii|iii|iv|2|3|4)\s*$/i.test(title))
    return "senior";
  if (/entry[- ]level|\bjunior\b|\bjr\.?\b|associate|\b(i|1)\s*$|level 1|engineer i\b/i.test(t)) return "entry";
  return "mid";
}

const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_STATE_NAMES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
const US_RE = new RegExp(
  `\\b(united states|usa|u\\.s\\.a?\\.?|us|${US_STATE_NAMES})\\b|,\\s*(${US_STATES})\\b|\\b(${US_STATES})\\s*$|\\b(new york|nyc|san francisco|seattle|austin|boston|chicago|atlanta|denver|los angeles|bay area|silicon valley)\\b`,
  "i"
);
const NON_US =
  /\b(canada|toronto|vancouver|montreal|ontario|united kingdom|\buk\b|london|england|ireland|dublin|germany|berlin|munich|france|paris|netherlands|amsterdam|spain|india|bangalore|bengaluru|hyderabad|pune|singapore|japan|tokyo|china|australia|sydney|brazil|mexico|poland|israel|tel aviv|emea|apac|latam|europe)\b/i;

export function isUsLocation(loc: string): boolean {
  if (!loc) return false;
  if (US_RE.test(loc)) return true;
  return false;
}

/** True when a remote job is open to US-based people. */
export function isUsRemote(loc: string): boolean {
  if (!loc || /^remote$|anywhere|worldwide|global/i.test(loc.trim())) return true;
  if (NON_US.test(loc) && !US_RE.test(loc)) return false;
  return US_RE.test(loc) || /north america|americas/i.test(loc);
}

const GA_RE =
  /\bGA\b|\bgeorgia\b(?!\s*\(country\))|atlanta|alpharetta|marietta|kennesaw|savannah|augusta|duluth,\s*ga|norcross|sandy springs|peachtree|roswell|smyrna|johns creek|lawrenceville|columbus,\s*ga|athens,\s*ga|macon/i;
export const isGeorgia = (loc: string) => GA_RE.test(loc);

export const isRemoteText = (s: string) => /\bremote\b|work from home|\bwfh\b|distributed/i.test(s);

/** Parse a salary range from free text; hourly pay is annualized (×2080). */
export function parseSalary(text: string): { min?: number; max?: number } {
  if (!text) return {};
  const re =
    /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?\s*(?:-|–|—|to)\s*\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?\s*(\/\s?(?:hr|hour)|per hour|an hour|hourly)?/;
  const m = text.match(re);
  const toNum = (v: string, k?: string) => {
    let n = parseFloat(v.replace(/,/g, ""));
    if (k) n *= 1000;
    return n;
  };
  if (m) {
    let min = toNum(m[1], m[2] ?? m[4]);
    let max = toNum(m[3], m[4]);
    if (m[5] || max < 500) {
      min *= 2080;
      max *= 2080;
    }
    if (max >= 10000 && max < 2_000_000) return { min: Math.round(min), max: Math.round(max) };
  }
  const single = text.match(/\$\s?(\d{2,3}(?:,\d{3})|\d{2,3}\s?[kK])\b/);
  if (single) {
    const n = toNum(single[1].replace(/\s?[kK]/, ""), /k/i.test(single[1]) ? "k" : undefined);
    if (n >= 10000 && n < 2_000_000) return { min: n, max: n };
  }
  return {};
}

export function stripHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function domainOf(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export type Ats = "greenhouse" | "lever" | "ashby" | "workday" | "other";

export function atsFromUrl(url: string): { ats: Ats; board?: string } {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const seg = u.pathname.split("/").filter(Boolean);
    if (/greenhouse\.io$/.test(h)) {
      if (seg[0] === "embed") return { ats: "greenhouse", board: u.searchParams.get("for") ?? undefined };
      return { ats: "greenhouse", board: seg[0] };
    }
    if (/lever\.co$/.test(h)) return { ats: "lever", board: seg[0] };
    if (/ashbyhq\.com$/.test(h)) return { ats: "ashby", board: seg[0] };
    if (/myworkdayjobs\.com$/.test(h)) return { ats: "workday" };
  } catch {
    /* not a URL */
  }
  return { ats: "other" };
}
