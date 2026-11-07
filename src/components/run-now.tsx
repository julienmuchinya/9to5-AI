"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAgentNow } from "@/app/actions";

type State = "idle" | "starting" | "queued" | "running";
interface Status {
  machine: { state: "idle" | "queued" | "running"; since: string | null; manual: boolean; last: { at: string; endedAt: string | null; ok: boolean; manual: boolean } | null; nextScheduled: string };
  lastRun: { started_at: string; ended_at: string | null; status: string; summary: Record<string, unknown> | null } | null;
  ai: { mode: "gemini" | "backup" | "out"; geminiResetsInH: number };
}

/** Time in the viewer's own time zone (server pages render in UTC). */
export const localTime = (iso: string | null | undefined, withDay = false) =>
  iso
    ? new Date(iso).toLocaleString(undefined, withDay ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit" })
    : "—";

const mins = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 0);

/** What the last run did, in a few words. */
function counts(summary: Record<string, unknown> | null | undefined): string {
  if (!summary) return "";
  const a = (summary.applications ?? {}) as Record<string, number>;
  const parts = [
    a.submitted ? `${a.submitted} sent` : null,
    a.needs_user ? `${a.needs_user} need you` : null,
    a.failed ? `${a.failed} failed` : null,
    a.closed ? `${a.closed} closed` : null,
    typeof summary.matched === "number" && summary.matched ? `${summary.matched} matched` : null,
    a.ai_calls ? `${a.ai_calls} AI calls` : null,
  ].filter(Boolean);
  if (!parts.length && a.gemini_limit) return "stopped: AI quota";
  if (!parts.length && a.cap_reached) return "daily cap reached";
  return parts.join(" · ") || "nothing to apply to";
}

/**
 * The agent's round status button. Its colour follows the real GitHub machine (polled), so it stays
 * right after a refresh: grey = idle, amber = starting / waiting for GitHub, green = running.
 */
export function RunNowButton({ running = false, label = "Run agent now", compact = false, details = false }: { running?: boolean; label?: string; compact?: boolean; details?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<Status | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const wasLive = useRef(running);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/status", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {
      // keep the last known state
    }
  }, []);

  const machine = status?.machine.state ?? (running ? "running" : "idle");
  // Just clicked: amber until GitHub shows the run (it takes a few seconds to appear), max 3 minutes.
  const justStarted = startedAt != null && Date.now() - startedAt < 180_000 && machine === "idle";
  const state: State = pending || justStarted ? "starting" : machine;
  const live = state !== "idle";

  useEffect(() => {
    poll();
    const t = setInterval(poll, live ? 10_000 : 60_000);
    return () => clearInterval(t);
  }, [poll, live]);

  // When a run finishes, refresh the page so counts and lists update.
  useEffect(() => {
    if (wasLive.current && machine === "idle" && !justStarted) router.refresh();
    wasLive.current = machine !== "idle";
  }, [machine, justStarted, router]);

  const ring = {
    idle: "bg-slate-600 text-white ring-slate-400/30 hover:bg-slate-500",
    starting: "bg-amber-500 text-white ring-amber-300/40",
    queued: "bg-amber-500 text-white ring-amber-300/40",
    running: "bg-emerald-500 text-white ring-emerald-300/50",
  }[state];
  const text =
    state === "running"
      ? `Agent running${status?.machine.since ? ` · ${mins(status.machine.since)} min` : ""}`
      : state === "queued"
        ? "Waiting for GitHub…"
        : state === "starting"
          ? "Starting…"
          : label;
  const last = status?.lastRun;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={live}
        aria-label={text}
        title={state === "running" ? "The agent is searching and applying right now" : state === "idle" ? "Start an agent run now" : "GitHub is starting the run"}
        className="group inline-flex items-center gap-2.5 rounded-full pr-3 text-sm font-medium disabled:cursor-default"
        onClick={() =>
          start(async () => {
            try {
              const r = await runAgentNow();
              if (r.started) setStartedAt(Date.now());
              setMsg({ ok: r.started, text: r.note ?? r.error ?? (r.started ? "Started" : "Couldn't start") });
              setTimeout(poll, 4000);
            } catch (e) {
              setMsg({ ok: false, text: (e as Error).message });
            }
          })
        }
      >
        <span className={`relative grid h-10 w-10 place-items-center rounded-full shadow-lg ring-4 transition ${ring}`}>
          {state === "running" && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" />}
          {state === "running" ? (
            <span className="relative flex gap-0.5" aria-hidden>
              <span className="h-3 w-1 animate-pulse rounded-sm bg-white" />
              <span className="h-3 w-1 animate-pulse rounded-sm bg-white [animation-delay:200ms]" />
              <span className="h-3 w-1 animate-pulse rounded-sm bg-white [animation-delay:400ms]" />
            </span>
          ) : state === "idle" ? (
            <svg viewBox="0 0 24 24" className="relative ml-0.5 h-4 w-4 fill-current" aria-hidden>
              <path d="M7 5v14l12-7z" />
            </svg>
          ) : (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
          )}
        </span>
        {!compact && <span className={state === "running" ? "text-emerald-300" : state === "idle" ? "text-[var(--foreground)]" : "text-amber-300"}>{text}</span>}
      </button>
      {details && status && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
          <dt>Last run</dt>
          <dd>
            {last ? (
              <>
                {localTime(last.started_at, true)} · <span className="text-[var(--foreground)]">{last.status === "running" ? "in progress" : counts(last.summary)}</span>
              </>
            ) : (
              "—"
            )}
          </dd>
          <dt>Next run</dt>
          <dd>
            ~{localTime(status.machine.nextScheduled, true)} <span className="opacity-70">(GitHub may start it late)</span>
          </dd>
          {status.ai.mode === "out" && (
            <>
              <dt>AI</dt>
              <dd className="text-amber-300">All free AI used — Gemini resets in {status.ai.geminiResetsInH} h</dd>
            </>
          )}
        </dl>
      )}
      {msg && <p className={`max-w-md text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</p>}
    </div>
  );
}
