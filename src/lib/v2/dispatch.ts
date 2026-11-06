/** Starting agent runs on GitHub Actions, and when the next scheduled one is. Server-only. */

/** Matches the cron in .github/workflows/daily-agent.yml: minute 17 of every 3rd hour (UTC). */
export function nextScheduledRun(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCMinutes(17, 0, 0);
  while (d <= now || d.getUTCHours() % 3 !== 0) d.setUTCHours(d.getUTCHours() + 1);
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
    body: JSON.stringify({ ref: "main", inputs: { discover: false, apply: true, apply_dry_run: false, only_user: userId } }),
  });
  if (res.ok) return { started: true, note: "Run started. It takes about a minute to boot, then applies to your queue (freshest jobs first)." };
  return { started: false, error: `GitHub refused (${res.status}): ${(await res.text()).slice(0, 150)}` };
}
