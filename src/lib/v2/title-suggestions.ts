import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Job titles worth adding to "Target roles": entry-level / new-grad postings the agent actually saw in
 * the last two weeks that pay at least `minPay`, most common first. When the pool is thin, a short list
 * of entry-level roles that usually pay $60K+ fills in (marked as typical, not seen).
 */
export interface TitleSuggestion {
  title: string;
  /** Postings seen in the last 2 weeks with this title (0 = from the typical list). */
  seen: number;
  /** Highest listed pay among them, in USD per year. */
  payUpTo: number | null;
  /** "tech" or "field" — for grouping on the page. */
  kind: "tech" | "field";
}

/** Entry-level roles that commonly pay $60K+ in the US and don't need years of experience. */
export const TYPICAL_ENTRY_60K: Omit<TitleSuggestion, "seen">[] = [
  { title: "IT Support Specialist", payUpTo: 65000, kind: "tech" },
  { title: "Technical Support Engineer", payUpTo: 75000, kind: "tech" },
  { title: "QA Analyst", payUpTo: 70000, kind: "tech" },
  { title: "Data Analyst", payUpTo: 75000, kind: "tech" },
  { title: "Junior Software Engineer", payUpTo: 90000, kind: "tech" },
  { title: "Cybersecurity Analyst", payUpTo: 80000, kind: "tech" },
  { title: "Network Technician", payUpTo: 65000, kind: "tech" },
  { title: "Implementation Specialist", payUpTo: 70000, kind: "tech" },
  { title: "GIS Analyst", payUpTo: 65000, kind: "tech" },
  { title: "Field Service Technician", payUpTo: 70000, kind: "field" },
  { title: "Roustabout", payUpTo: 65000, kind: "field" },
  { title: "Floorhand", payUpTo: 70000, kind: "field" },
  { title: "Lease Operator", payUpTo: 75000, kind: "field" },
  { title: "Process Operator", payUpTo: 75000, kind: "field" },
  { title: "Pipeline Operator", payUpTo: 75000, kind: "field" },
  { title: "Instrumentation Technician", payUpTo: 75000, kind: "field" },
  { title: "Wind Turbine Technician", payUpTo: 65000, kind: "field" },
  { title: "Controls Technician", payUpTo: 70000, kind: "field" },
];

const FIELD = /operator|technician|roustabout|floorhand|driller|rig|field|plant|pipeline|offshore|electrician|mechanic|lineman|welder/i;

/** "Software Engineer I (Remote)" → "Software Engineer". */
export function cleanTitle(t: string): string {
  return t
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s[-–—|,:].*$/, "")
    .replace(/\b(I|1|Level 1|Entry[- ]Level|Junior|Jr\.?|New Grad(uate)?|Early Career|Associate|20\d\d)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function suggestTitles(sb: SupabaseClient, opts: { have: string[]; minPay?: number; limit?: number }): Promise<TitleSuggestion[]> {
  const minPay = opts.minPay ?? 60000;
  const have = new Set(opts.have.map((h) => h.toLowerCase().trim()));
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data } = await sb
    .from("job_postings")
    .select("title,salary_max,salary_min")
    .eq("active", true)
    .in("level", ["entry", "new_grad"])
    .gte("salary_max", minPay)
    .gte("posted_at", since)
    .neq("verification_status", "rejected")
    .limit(3000);
  const groups = new Map<string, TitleSuggestion>();
  for (const r of data ?? []) {
    const title = cleanTitle(String(r.title ?? ""));
    if (title.length < 4 || title.length > 40 || have.has(title.toLowerCase())) continue;
    const k = title.toLowerCase();
    const g = groups.get(k) ?? { title, seen: 0, payUpTo: null, kind: FIELD.test(title) ? "field" : "tech" };
    g.seen++;
    g.payUpTo = Math.max(g.payUpTo ?? 0, Number(r.salary_max ?? r.salary_min ?? 0)) || null;
    groups.set(k, g);
  }
  const seen = [...groups.values()].filter((g) => g.seen >= 2).sort((a, b) => b.seen - a.seen);
  const typical = TYPICAL_ENTRY_60K.filter((t) => !have.has(t.title.toLowerCase()) && !groups.has(t.title.toLowerCase()) && (t.payUpTo ?? 0) >= minPay).map((t) => ({ ...t, seen: 0 }));
  return [...seen.slice(0, opts.limit ?? 16), ...typical].slice(0, (opts.limit ?? 16) + 8);
}
