import { searchHimalayas, searchJobicy, searchRemotive, searchUsajobs, usajobsEnabled, type Posting } from "./sources";
import { WORKDAY_BOARDS, fetchWorkdayBoard, listJobsStatus, postedDaysAgo, workdayKey, type ListRow, type WorkdayBoard } from "./workday";
import { isUsLocation } from "./filters";

/** One job found by a live search, before it's saved anywhere. */
export interface LiveHit {
  key: string;
  source: "remotive" | "jobicy" | "workday" | "himalayas" | "usajobs";
  title: string;
  company: string;
  location: string;
  is_remote: boolean;
  url: string;
  posted_at: string | null;
  /** The source's own wording when it only gives a day ("Posted Today", "Posted 3 Days Ago"). */
  posted_label?: string;
  salary_min?: number;
  salary_max?: number;
  /** Plain-text description when the source sends it in the search results (Workday doesn't). */
  description?: string;
  level?: string;
}

const fromPosting = (p: Posting): LiveHit => ({
  key: p.source_key,
  source: p.source as LiveHit["source"],
  title: p.title,
  company: p.company_name,
  location: p.locations.join("; "),
  is_remote: p.is_remote,
  url: p.apply_url || p.url,
  posted_at: p.posted_at ?? null,
  salary_min: p.salary_min,
  salary_max: p.salary_max,
  description: p.description,
  level: p.level,
});

/**
 * Industry words → the employers in that industry. "oil" should bring every opening at Chevron, Shell,
 * Transocean… (roustabouts, accountants, truck drivers, engineers), not only titles that contain "oil".
 */
const INDUSTRY: { re: RegExp; sectors: WorkdayBoard["sector"][] }[] = [
  { re: /\b(oil|gas|petroleum|energy|offshore|drilling|rig|refiner(y|ies)|pipelines?|midstream|upstream|downstream|lng|oilfield|oil ?field|fracking|frac)\b/i, sectors: ["energy"] },
  { re: /\b(mining|mine|minerals?)\b/i, sectors: ["mining", "energy"] },
  { re: /\b(utilit(y|ies)|power|electric company|waste|water)\b/i, sectors: ["utilities", "energy"] },
  { re: /\b(bank|banking|finance|financial|insurance|credit|investment|accounting)\b/i, sectors: ["finance"] },
  { re: /\b(health ?care|hospital|medical|pharma(cy|ceutical)?|clinic(al)?|nursing|insurance)\b/i, sectors: ["healthcare"] },
  { re: /\b(retail|store|stores|shop|merchandis(e|ing))\b/i, sectors: ["retail"] },
  { re: /\b(government|federal|defen[cs]e|military|clearance|public sector)\b/i, sectors: ["government"] },
  { re: /\b(manufacturing|plant|factory|industrial|chemicals?|aerospace)\b/i, sectors: ["industrial"] },
  { re: /\b(tech|technology|software|it)\b/i, sectors: ["tech"] },
];
/** Job words → the kind of employer that hires for them (read their newest openings, keep matching titles). */
const ROLE_HINTS: { re: RegExp; sectors: WorkdayBoard["sector"][] }[] = [
  { re: /\b(cashier|stocker|store|sales associate|retail|merchandiser|warehouse|forklift|picker|packer|team member|customer service)\b/i, sectors: ["retail"] },
  { re: /\b(nurse|nursing|rn|lpn|cna|medical assistant|pharmac(y|ist)|phlebotom|caregiver|patient|clinical|therapist|technologist)\b/i, sectors: ["healthcare"] },
  { re: /\b(teller|banker|loan|underwriter|claims|accountant|accounting|auditor|analyst|insurance agent|financial advisor)\b/i, sectors: ["finance"] },
  { re: /\b(roustabout|roughneck|driller|floorhand|operator|lease|welder|electrician|mechanic|technician|truck driver|cdl|driver)\b/i, sectors: ["energy", "industrial", "utilities"] },
  { re: /\b(security officer|clearance|intelligence|logistics)\b/i, sectors: ["government"] },
];
export const roleHintSectors = (term: string) => [...new Set(ROLE_HINTS.filter((x) => x.re.test(term)).flatMap((x) => x.sectors))];

export const industrySectors = (term: string) => [...new Set(INDUSTRY.filter((x) => x.re.test(term)).flatMap((x) => x.sectors))];

/** Keyword search on every Workday employer the agent knows (energy, healthcare, banking, retail, government, tech…). */
async function searchWorkday(term: string, perBoard: number, timeoutMs: number, onThrottled: (n: number) => void): Promise<LiveHit[]> {
  // At most 12 employers at a time: all 61 at once is what got the search throttled (HTTP 429).
  const lists: { b: WorkdayBoard; rows: ListRow[] }[] = [];
  let throttled = 0;
  // Each employer's own search (it looks in the whole posting, not just the title), plus — for an industry
  // word — that industry's employers' newest openings of every kind.
  const sectors = industrySectors(term);
  type Job = { b: WorkdayBoard; q: string; n: number; titleOnly?: boolean };
  // A job word ("cashier", "teller", "nurse") also reads the newest openings at employers that hire for it,
  // keeping the ones whose title has the word; an industry word ("oil") keeps all of them.
  const roleSectors = roleHintSectors(term).filter((x) => !sectors.includes(x));
  const jobs: Job[] = [
    ...WORKDAY_BOARDS.filter((b) => sectors.includes(b.sector)).map((b) => ({ b, q: "", n: 20 })),
    ...WORKDAY_BOARDS.filter((b) => roleSectors.includes(b.sector)).map((b) => ({ b, q: "", n: 20, titleOnly: true })),
    ...WORKDAY_BOARDS.map((b) => ({ b, q: term, n: perBoard })),
  ];
  let skipped = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (let j = jobs.shift(); j; j = jobs.shift()) {
        // Workday throttles by address: after a few refusals, asking the rest only makes it last longer.
        if (throttled >= 6) {
          skipped++;
          continue;
        }
        const r = await listJobsStatus(j.b, j.q, j.n, timeoutMs);
        if (r.status === "throttled") throttled++;
        lists.push({ b: j.b, rows: j.titleOnly ? r.rows.filter((x) => titleMatches(x.title, term, "any")) : r.rows });
      }
    })
  );
  throttled += skipped;
  if (throttled) onThrottled(throttled);
  const out: LiveHit[] = [];
  for (const { b, rows } of lists) {
    for (const r of rows) {
      const loc = r.locationsText ?? "";
      // "2 Locations" says nothing; otherwise keep US places and remote only.
      if (loc && !/locations?$/i.test(loc) && !isUsLocation(loc) && !/remote/i.test(loc)) continue;
      const days = postedDaysAgo(r.postedOn);
      out.push({
        key: workdayKey(b, r.externalPath),
        source: "workday",
        title: r.title,
        company: b.company,
        location: loc || "See posting",
        is_remote: /remote/i.test(loc),
        url: `https://${b.host}.myworkdayjobs.com/${b.site}${r.externalPath}`,
        posted_at: days != null ? new Date(Date.now() - days * 86400_000).toISOString() : null,
        posted_label: days == null ? undefined : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`,
      });
    }
  }
  return out;
}

const STOP = new Set(["and", "or", "the", "of", "for", "in", "at", "to", "a", "an", "job", "jobs", "remote", "position"]);
/** Search words reduced to stems ("nurses" → "nurse", "analysts" → "analyst"). */
export const searchStems = (term: string) =>
  term
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, "") : w));

/** Does a job title contain the search words? Prefix match per word, so "analyst" also finds "Analytics". */
export function titleMatches(title: string, term: string, mode: "all" | "any"): boolean {
  const stems = searchStems(term);
  if (!stems.length) return true;
  const words = title.toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
  const has = (s: string) => words.some((w) => w.startsWith(s.length > 5 ? s.slice(0, 5) : s));
  return mode === "all" ? stems.every(has) : stems.some(has);
}

/**
 * Search live job sources for a keyword, in parallel, giving up on any source that's slow.
 * Returns newest first, de-duplicated by title + company.
 */
export async function liveSearch(term: string, opts: { timeoutMs?: number; perBoard?: number } = {}): Promise<{ hits: LiveHit[]; failed: string[] }> {
  const t = term.trim();
  if (t.length < 2) return { hits: [], failed: [] };
  const timeoutMs = opts.timeoutMs ?? 9000;
  const failed: string[] = [];
  const guard = async <T,>(name: string, p: Promise<T[]>): Promise<T[]> => {
    try {
      return await p;
    } catch {
      failed.push(name);
      return [];
    }
  };
  const [remotive, jobicy, himalayas, usajobs, workday] = await Promise.all([
    guard("Remotive", searchRemotive(t, timeoutMs).then((ps) => ps.map(fromPosting))),
    guard("Jobicy", searchJobicy(t, timeoutMs).then((ps) => ps.map(fromPosting))),
    guard("Himalayas", searchHimalayas(t, timeoutMs).then((ps) => ps.map(fromPosting))),
    usajobsEnabled() ? guard("USAJOBS", searchUsajobs(t, timeoutMs).then((ps) => ps.map(fromPosting))) : Promise.resolve([] as LiveHit[]),
    guard(
      "employer sites",
      searchWorkday(t, opts.perBoard ?? 6, timeoutMs, () => failed.push("some employer sites (busy — their jobs collected earlier are still included)"))
    ),
  ]);
  const seen = new Set<string>();
  const all = [...workday, ...usajobs, ...remotive, ...jobicy, ...himalayas];
  // Titles that contain the words come first, then everything else the sources found for them (the word in
  // the company, the description, or an employer in that industry). Nothing is dropped for its field.
  const hits = all
    .map((h) => ({ h, rank: relevance(h, t) }))
    .filter((x) => x.rank > 0)
    .filter(({ h }) => {
      const k = `${h.title.toLowerCase().replace(/\W+/g, " ").trim()}|${h.company.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.rank - a.rank || Date.parse(b.h.posted_at ?? "0") - Date.parse(a.h.posted_at ?? "0"))
    .map((x) => x.h);
  return { hits, failed };
}

/**
 * How well a hit answers the search: 3 = every word in the title, 2 = some, 1 = in the company or the
 * description, or an employer in the industry searched for (an employer's own search already looked
 * through the whole posting). 0 = unrelated (a loose match by a job board).
 */
export function relevance(h: Pick<LiveHit, "title" | "company" | "source" | "description">, term: string): number {
  if (titleMatches(h.title, term, "all")) return 3;
  if (titleMatches(h.title, term, "any")) return 2;
  if (titleMatches(h.company, term, "any")) return 1;
  if (h.source === "workday" || h.source === "usajobs") return 1;
  const stems = searchStems(term);
  const d = (h.description ?? "").toLowerCase();
  if (stems.length && stems.every((s) => new RegExp(`\\b${s.replace(/[^a-z0-9]/g, "")}`).test(d))) return 1;
  return 0;
}

/**
 * Several live results at once (Search → select → Apply with agent): one search per source and one
 * listing per employer, instead of one per job. Keys that can't be found any more are left out.
 */
export async function resolveLiveHits(keys: string[], term: string): Promise<Posting[]> {
  const want = new Set(keys);
  const by = (src: string) => keys.filter((k) => k.startsWith(`${src}:`));
  const pick = (ps: Posting[]) => ps.filter((p) => want.has(p.source_key));
  const tasks: Promise<Posting[]>[] = [];
  if (by("remotive").length) tasks.push(searchRemotive(term, 12000).then(pick).catch(() => []));
  if (by("jobicy").length) tasks.push(searchJobicy(term, 12000).then(pick).catch(() => []));
  if (by("himalayas").length) tasks.push(searchHimalayas(term, 12000).then(pick).catch(() => []));
  if (by("usajobs").length) tasks.push(searchUsajobs(term, 12000).then(pick).catch(() => []));
  const tenants = [...new Set(by("workday").map((k) => k.split(":")[1]))];
  for (const t of tenants) {
    const board = WORKDAY_BOARDS.find((b) => b.tenant === t);
    if (board) tasks.push(fetchWorkdayBoard(board, [term, ""], { maxAgeDays: 3650, perQuery: 20, skip: (k) => !want.has(k) }).then(pick).catch(() => []));
  }
  return (await Promise.all(tasks)).flat();
}

/**
 * Re-fetch one live result by its key on the server, so what gets saved comes from the source itself,
 * never from what the browser sent. Returns null if it can't be found any more.
 */
export async function resolveLiveHit(key: string, term: string): Promise<Posting | null> {
  const [source, ...rest] = key.split(":");
  if (source === "remotive") return (await searchRemotive(term, 12000)).find((p) => p.source_key === key) ?? null;
  if (source === "jobicy") return (await searchJobicy(term, 12000)).find((p) => p.source_key === key) ?? null;
  if (source === "usajobs") return (await searchUsajobs(term, 12000)).find((p) => p.source_key === key) ?? null;
  if (source === "himalayas") return (await searchHimalayas(term, 12000)).find((p) => p.source_key === key) ?? null;
  if (source === "workday") {
    const board = WORKDAY_BOARDS.find((b) => b.tenant === rest[0]);
    if (!board) return null;
    // "" too: a job listed because its employer is in the industry searched for ("oil") may not mention the word.
    const got = await fetchWorkdayBoard(board, [term, ""], { maxAgeDays: 3650, perQuery: 20, skip: (k) => k !== key });
    return got.find((p) => p.source_key === key) ?? null;
  }
  return null;
}
