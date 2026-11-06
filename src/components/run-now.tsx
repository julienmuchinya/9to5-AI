"use client";

import { useState, useTransition } from "react";
import { runAgentNow } from "@/app/actions";
import { buttonCls } from "@/components/ui";

/** Starts an agent run for this account right away (GitHub Actions dispatch). */
export function RunNowButton({ label = "Run agent now" }: { label?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={pending}
        className={buttonCls("primary", "sm")}
        onClick={() =>
          start(async () => {
            try {
              const r = await runAgentNow();
              setMsg({ ok: r.started, text: r.note ?? r.error ?? (r.started ? "Started" : "Couldn't start") });
            } catch (e) {
              setMsg({ ok: false, text: (e as Error).message });
            }
          })
        }
      >
        {pending ? "Starting…" : `▶ ${label}`}
      </button>
      {msg && <p className={`max-w-md text-xs ${msg.ok ? "text-emerald-300" : "text-amber-300"}`}>{msg.text}</p>}
    </div>
  );
}
