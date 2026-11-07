"use client";

import { useState, useTransition } from "react";
import { runAgentNow } from "@/app/actions";

/**
 * The agent's round status button.
 *  - Running: green, pulsing ring, "Agent running" (can't be started twice).
 *  - Idle:    slate grey with a play icon, "Run agent now" — click to start a run.
 *  - Starting: amber while the run is being dispatched.
 */
export function RunNowButton({ running = false, label = "Run agent now", compact = false }: { running?: boolean; label?: string; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [started, setStarted] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const live = running || started;
  const state = pending ? "starting" : live ? "running" : "idle";
  const ring = {
    idle: "bg-slate-600 text-white ring-slate-400/30 hover:bg-slate-500",
    starting: "bg-amber-500 text-white ring-amber-300/40",
    running: "bg-emerald-500 text-white ring-emerald-300/50",
  }[state];
  const text = state === "running" ? "Agent running" : state === "starting" ? "Starting…" : label;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={pending || live}
        aria-label={text}
        title={state === "running" ? "The agent is applying right now" : "Start an agent run now"}
        className="group inline-flex items-center gap-2.5 rounded-full pr-3 text-sm font-medium disabled:cursor-default"
        onClick={() =>
          start(async () => {
            try {
              const r = await runAgentNow();
              if (r.started) setStarted(true);
              setMsg({ ok: r.started, text: r.note ?? r.error ?? (r.started ? "Started" : "Couldn't start") });
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
          ) : state === "starting" ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
          ) : (
            <svg viewBox="0 0 24 24" className="relative ml-0.5 h-4 w-4 fill-current" aria-hidden>
              <path d="M7 5v14l12-7z" />
            </svg>
          )}
        </span>
        {!compact && <span className={state === "running" ? "text-emerald-300" : "text-[var(--foreground)]"}>{text}</span>}
      </button>
      {msg && <p className={`max-w-md text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</p>}
    </div>
  );
}
