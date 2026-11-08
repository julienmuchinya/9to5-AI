import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One definition of every pipeline number, used by the Dashboard, Applications and Resumes pages so
 * they always agree. (The dashboard used to count only status = "submitted" as sent, while
 * Applications also counted received / in review / interview / rejected — and Applications only
 * looked at its newest 400 rows.)
 */
export const SENT = ["submitted", "received", "under_review", "screening", "interview", "offer", "rejected", "withdrawn"] as const;
export const PROGRESSED = ["under_review", "screening", "interview", "offer"] as const;
export const IN_REVIEW = ["received", "under_review"] as const;

export interface StatusRow {
  status: string;
  submitted_at: string | null;
  resume_focus: string | null;
}

export const isSent = (r: { status: string; submitted_at?: string | null }) => Boolean(r.submitted_at) || (SENT as readonly string[]).includes(r.status);

export interface PipelineCounts {
  total: number;
  queued: number;
  sent: number;
  needs: number;
  inReview: number;
  screening: number;
  interviews: number;
  rejected: number;
  failed: number;
  closed: number;
}

export function countPipeline(rows: { status: string; submitted_at?: string | null }[]): PipelineCounts {
  const c: PipelineCounts = { total: rows.length, queued: 0, sent: 0, needs: 0, inReview: 0, screening: 0, interviews: 0, rejected: 0, failed: 0, closed: 0 };
  for (const r of rows) {
    if (isSent(r)) c.sent++;
    if (r.status === "queued") c.queued++;
    else if (r.status === "needs_user") c.needs++;
    else if ((IN_REVIEW as readonly string[]).includes(r.status)) c.inReview++;
    else if (r.status === "screening") c.screening++;
    else if (r.status === "interview" || r.status === "offer") c.interviews++;
    else if (r.status === "rejected") c.rejected++;
    else if (r.status === "failed") c.failed++;
    else if (r.status === "closed") c.closed++;
  }
  return c;
}

/** Every application's status for one user (paged past Supabase's 1000-row cap). Light: 3 columns. */
export async function statusRows(sb: SupabaseClient, userId: string): Promise<StatusRow[]> {
  const out: StatusRow[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from("applications").select("status,submitted_at,resume_focus").eq("user_id", userId).range(from, from + 999);
    if (error || !data?.length) break;
    out.push(...(data as StatusRow[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** Which resume an application used: "Label · focus" (several resumes) or just a skill focus (main resume). */
export function resumeLabelOf(focus: string | null, labels: string[], mainLabel: string): string {
  if (focus && focus.includes(" · ")) {
    const label = focus.split(" · ")[0];
    if (labels.includes(label)) return label;
  }
  if (focus && labels.includes(focus)) return focus;
  return mainLabel;
}

export interface ResumeStats {
  sent: number;
  progressed: number;
  interviews: number;
  rejected: number;
  /** Share of sent applications that moved forward (review, interview or offer). */
  rate: number;
}

export function statsByResume(rows: StatusRow[], labels: string[], mainLabel: string): Map<string, ResumeStats> {
  const m = new Map<string, ResumeStats>();
  for (const r of rows) {
    if (!isSent(r)) continue;
    const k = resumeLabelOf(r.resume_focus, labels, mainLabel);
    const v = m.get(k) ?? { sent: 0, progressed: 0, interviews: 0, rejected: 0, rate: 0 };
    v.sent++;
    if ((PROGRESSED as readonly string[]).includes(r.status)) v.progressed++;
    if (r.status === "interview" || r.status === "offer") v.interviews++;
    if (r.status === "rejected") v.rejected++;
    v.rate = v.progressed / v.sent;
    m.set(k, v);
  }
  return m;
}
