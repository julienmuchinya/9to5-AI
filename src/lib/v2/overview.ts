import { isSent } from "./pipeline";

/** "Good morning/afternoon/evening" for an hour 0–23 in the viewer's time zone. */
export function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return "Good evening";
  if (hour < 12) return "Good morning";
  return "Good afternoon";
}

/** Hour 0–23 of `now` in a time zone. */
export function hourIn(tz: string, now = new Date()): number {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  return Number.isFinite(h) ? h % 24 : now.getUTCHours();
}

const dayKey = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * Applications sent per day for the last 7 days (oldest first, today last), in the viewer's time zone.
 * Only real submitted_at timestamps count — nothing is estimated.
 */
export function weekActivity(submittedAt: (string | null)[], tz: string, now = new Date()): { label: string; key: string; count: number }[] {
  const days: { label: string; key: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000);
    days.push({ key: dayKey(d, tz), label: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d), count: 0 });
  }
  const idx = new Map(days.map((d, i) => [d.key, i]));
  for (const s of submittedAt) {
    if (!s) continue;
    const i = idx.get(dayKey(new Date(s), tz));
    if (i !== undefined) days[i].count++;
  }
  return days;
}

/** Statuses that only happen after the employer (or its system) replied — set from the inbox or by you. */
export const RESPONDED = ["received", "under_review", "screening", "interview", "offer", "rejected"] as const;
/** Statuses that mean a human at the employer moved it forward or decided. */
export const EMPLOYER_REPLIED = ["under_review", "screening", "interview", "offer", "rejected"] as const;

export interface Funnel {
  tracked: number;
  sent: number;
  /** Sent and later confirmed received (or further along). */
  confirmed: number;
  responses: number;
  interviews: number;
  offers: number;
}

/** Tracked → sent → confirmed → responses → interviews. Each step counts only evidenced states. */
export function funnel(rows: { status: string; submitted_at?: string | null }[]): Funnel {
  const f: Funnel = { tracked: rows.length, sent: 0, confirmed: 0, responses: 0, interviews: 0, offers: 0 };
  for (const r of rows) {
    if (!isSent(r)) continue;
    f.sent++;
    if ((RESPONDED as readonly string[]).includes(r.status)) f.confirmed++;
    if ((EMPLOYER_REPLIED as readonly string[]).includes(r.status)) f.responses++;
    if (r.status === "interview" || r.status === "offer") f.interviews++;
    if (r.status === "offer") f.offers++;
  }
  return f;
}

/** Whole-number percentage, or null when there is nothing to divide by (shown as "—", never 0%). */
export const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((100 * n) / d) : null);

/**
 * Plain-language state of one application, keeping "submitted" apart from "confirmed":
 * the agent's own success check is not the same as the employer confirming receipt.
 */
export function stateLabel(status: string): { label: string; tone: "accent" | "info" | "success" | "warning" | "danger" | "default"; next: string } {
  switch (status) {
    case "queued":
      return { label: "Queued", tone: "accent", next: "Agent applies on its next run" };
    case "needs_user":
      return { label: "Needs you", tone: "warning", next: "Open it to see what's missing" };
    case "failed":
      return { label: "Failed", tone: "danger", next: "Retry, or apply yourself" };
    case "submitted":
      return { label: "Submitted · unconfirmed", tone: "info", next: "Waiting for the employer's confirmation email" };
    case "received":
      return { label: "Confirmed received", tone: "success", next: "Await employer response" };
    case "under_review":
      return { label: "Under review", tone: "info", next: "Await employer response" };
    case "screening":
      return { label: "Screening", tone: "success", next: "Prepare for a recruiter call" };
    case "interview":
      return { label: "Interview", tone: "success", next: "Prepare for the interview" };
    case "offer":
      return { label: "Offer", tone: "success", next: "Review the offer" };
    case "rejected":
      return { label: "Rejected", tone: "danger", next: "No action needed" };
    case "withdrawn":
      return { label: "Withdrawn", tone: "default", next: "No action needed" };
    case "closed":
      return { label: "Posting closed", tone: "default", next: "No action needed" };
    default:
      return { label: status.replace(/_/g, " "), tone: "default", next: "" };
  }
}
