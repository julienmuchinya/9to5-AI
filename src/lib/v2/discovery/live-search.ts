import { searchHimalayas, searchJobicy, searchRemotive, type Posting } from "./sources";
import { WORKDAY_BOARDS, fetchWorkdayBoard, listJobsStatus, postedDaysAgo, workdayKey, type ListRow, type WorkdayBoard } from "./workday";
import { isUsLocation } from "./filters";

/** One job found by a live search, before it's saved anywhere. */
export interface LiveHit {
  key: string;
  source: "remotive" | "jobicy" | "workday" | "himalayas";
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

/** Keyword search on every Workday employer the agent knows (energy, healthcare, banking, retail, government, tech…). */
async function searchWorkday(term: string, perBoard: number, timeoutMs: number, onThrottled: (n: number) => void): Promise<LiveHit[]> {
  // At most 12 employers at a time: all 61 at once is what got the search throttled (HTTP 429).
  const lists: { b: WorkdayBoard; rows: ListRow[] }[] = [];
  let throttled = 0;
  const queue = [...WORKDAY_BOARDS];
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        const r = await listJobsStatus(b, term, perBoard, timeoutMs);
        if (r.status === "throttled") throttled++;
        lists.push({ b, rows: r.rows });
      }
    })
  );
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
  const [remotive, jobicy, himalayas, workday] = await Promise.all([
    guard("Remotive", searchRemotive(t, timeoutMs).then((ps) => ps.map(fromPosting))),
    guard("Jobicy", searchJobicy(t, timeoutMs).then((ps) => ps.map(fromPosting))),
    guard("Himalayas", searchHimalayas(t, timeoutMs).then((ps) => ps.map(fromPosting))),
    guard(
      "employer sites",
      searchWorkday(t, opts.perBoard ?? 6, timeoutMs, (n) => failed.push(`${n} employer site${n === 1 ? "" : "s"} (busy — try again in a few minutes)`))
    ),
  ]);
  const seen = new Set<string>();
  const all = [...workday, ...remotive, ...jobicy, ...himalayas];
  // The sources match loosely ("nurse" also returns store jobs): keep titles that contain every search word,
  // or — if that leaves nothing — any of them.
  const strict = all.filter((h) => titleMatches(h.title, t, "all"));
  const relevant = strict.length ? strict : all.filter((h) => titleMatches(h.title, t, "any"));
  const hits = relevant.filter((h) => {
    const k = `${h.title.toLowerCase().replace(/\W+/g, " ").trim()}|${h.company.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  hits.sort((a, b) => Date.parse(b.posted_at ?? "0") - Date.parse(a.posted_at ?? "0"));
  return { hits, failed };
}

/**
 * Re-fetch one live result by its key on the server, so what gets saved comes from the source itself,
 * never from what the browser sent. Returns null if it can't be found any more.
 */
export async function resolveLiveHit(key: string, term: string): Promise<Posting | null> {
  const [source, ...rest] = key.split(":");
  if (source === "remotive") return (await searchRemotive(term, 12000)).find((p) => p.source_key === key) ?? null;
  if (source === "jobicy") return (await searchJobicy(term, 12000)).find((p) => p.source_key === key) ?? null;
  if (source === "himalayas") return (await searchHimalayas(term, 12000)).find((p) => p.source_key === key) ?? null;
  if (source === "workday") {
    const board = WORKDAY_BOARDS.find((b) => b.tenant === rest[0]);
    if (!board) return null;
    const got = await fetchWorkdayBoard(board, [term], { maxAgeDays: 3650, perQuery: 20, skip: (k) => k !== key });
    return got.find((p) => p.source_key === key) ?? null;
  }
  return null;
}
