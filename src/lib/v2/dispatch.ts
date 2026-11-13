/** Starting agent runs on GitHub Actions, and when the next scheduled one is. Server-only. */

/** Matches the cron in .github/workflows/daily-agent.yml: minute 17 of every 2nd hour (UTC). */
export function nextScheduledRun(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCMinutes(17, 0, 0);
  while (d <= now || d.getUTCHours() % 2 !== 0) d.setUTCHours(d.getUTCHours() + 1);
  return d;
}

export const dispatchConfigured = () => Boolean(process.env.GH_DISPATCH_TOKEN);

export async function dispatchAgentRun(userId: string): Promise<{ started: boolean; note?: string; error?: string }> {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo = process.env.GH_REPO ?? "julienmuchinya/9to5-AI";
  if (!token)
    return {
      started: false,
      note: `Instant runs aren't set up yet (GH_DISPATCH_TOKEN is missing on the server). The next automatic run is around ${nextScheduledRun().toUTCString()}.`,
    };
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/daily-agent.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    // discover: true — a manual run also searches for new postings (it used to only work the existing queue).
    body: JSON.stringify({ ref: "main", inputs: { discover: true, apply: true, apply_dry_run: false, only_user: userId } }),
  });
  if (res.ok) return { started: true, note: "Run started. It boots in about a minute, searches for new postings, then applies (freshest first). This button stays green until it finishes." };
  return { started: false, error: `GitHub refused (${res.status}): ${(await res.text()).slice(0, 150)}` };
}

export type MachineState = "idle" | "queued" | "running";
export interface MachineStatus {
  state: MachineState;
  /** When the current (or last) GitHub run started. */
  since: string | null;
  manual: boolean;
  /** The last finished run. */
  last: { at: string; endedAt: string | null; ok: boolean; manual: boolean } | null;
  nextScheduled: string;
  /** GitHub often starts scheduled runs late or skips them; this says so honestly. */
  scheduleNote: string;
}

/** The agent machine's real state, from GitHub Actions (falls back to "idle" without a token). */
export async function machineStatus(): Promise<MachineStatus> {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo = process.env.GH_REPO ?? "julienmuchinya/9to5-AI";
  const base: MachineStatus = {
    state: "idle",
    since: null,
    manual: false,
    last: null,
    nextScheduled: nextScheduledRun().toISOString(),
    scheduleNote: "GitHub starts scheduled runs when it has capacity — often up to a few hours late on the free plan.",
  };
  if (!token) return base;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/daily-agent.yml/runs?per_page=6`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) return base;
    const runs = ((await res.json()).workflow_runs ?? []) as { status: string; conclusion: string | null; event: string; created_at: string; run_started_at?: string; updated_at: string }[];
    const live = runs.find((r) => r.status === "in_progress") ?? runs.find((r) => ["queued", "waiting", "pending", "requested"].includes(r.status));
    const done = runs.find((r) => r.status === "completed");
    return {
      ...base,
      state: live ? (live.status === "in_progress" ? "running" : "queued") : "idle",
      since: live ? (live.run_started_at ?? live.created_at) : null,
      manual: live?.event === "workflow_dispatch",
      last: done ? { at: done.run_started_at ?? done.created_at, endedAt: done.updated_at, ok: done.conclusion === "success", manual: done.event === "workflow_dispatch" } : null,
    };
  } catch {
    return base;
  }
}
