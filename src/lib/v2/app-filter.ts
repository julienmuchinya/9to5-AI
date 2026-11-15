import { SENT } from "./pipeline";

/** Which statuses each Applications filter tab shows. "sent" also includes anything with a submitted date. */
export const APP_FILTER: Record<string, string[] | null> = {
  needs: ["needs_user"],
  drafts: ["draft"],
  queued: ["queued"],
  sent: [...SENT],
  review: ["received", "under_review"],
  screening: ["screening"],
  interview: ["interview", "offer"],
  rejected: ["rejected"],
  failed: ["failed", "closed", "ignored"],
  all: null,
};

export const isAppTab = (t: string | null | undefined): t is string => Boolean(t && t in APP_FILTER);

/**
 * How to narrow an applications query to one tab (same rules as the tab counts):
 * `or` → query.or(value), `statuses` → query.in("status", value), neither → no filter.
 */
export function appTabFilter(tab: string): { or?: string; statuses?: string[] } {
  if (tab === "sent") return { or: `submitted_at.not.is.null,status.in.(${SENT.join(",")})` };
  const statuses = APP_FILTER[tab];
  return statuses ? { statuses } : {};
}
