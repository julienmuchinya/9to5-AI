import type { SupabaseClient } from "@supabase/supabase-js";

export type LogLevel = "info" | "warn" | "error";
export type LogArea = "resume" | "chat" | "profile" | "settings" | "inbox" | "auth" | "agent" | "jobs" | "applications" | "vault" | "system";

/**
 * Record what happened so failures can be seen on the System status page (and in Vercel logs).
 * Never throws — logging must not break the thing being logged. `db` must be a service client.
 */
export async function logEvent(
  db: SupabaseClient,
  e: { user_id: string; area: LogArea; level?: LogLevel; message: string; meta?: Record<string, unknown> }
): Promise<void> {
  const level = e.level ?? "info";
  const line = `[${level}] [${e.area}] ${e.message}`;
  if (level === "error") console.error(line);
  else console.log(line);
  try {
    await db.from("agent_logs").insert({
      user_id: e.user_id,
      level,
      message: e.message.slice(0, 1000),
      metadata: { area: e.area, ...(e.meta ?? {}) },
    });
    // Keep the free database small: occasionally drop logs older than 30 days.
    if (Math.random() < 0.02) await db.from("agent_logs").delete().lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
  } catch {
    /* ignore */
  }
}

/** Time an async step and log it if it's slow or fails. */
export async function timed<T>(db: SupabaseClient, userId: string, area: LogArea, label: string, fn: () => Promise<T>, slowMs = 4000): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    if (ms > slowMs) await logEvent(db, { user_id: userId, area, level: "warn", message: `${label} was slow (${ms} ms)`, meta: { ms } });
    return out;
  } catch (err) {
    await logEvent(db, { user_id: userId, area, level: "error", message: `${label} failed: ${(err as Error).message}`, meta: { ms: Date.now() - t0 } });
    throw err;
  }
}
