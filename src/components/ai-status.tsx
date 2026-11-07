import Link from "next/link";
import type { AiStatusData } from "@/lib/v2/ai-status";

function Bar({ used, stopAt, limit }: { used: number; stopAt: number; limit: number }) {
  const pct = Math.min(100, (used / Math.max(1, limit)) * 100);
  const stopPct = Math.min(100, (stopAt / Math.max(1, limit)) * 100);
  const color = used >= stopAt ? "bg-red-500" : pct > stopPct * 0.7 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      <div className="absolute inset-y-0 w-px bg-[var(--muted)]/60" style={{ left: `${stopPct}%` }} title="Agent stops here (85%)" />
    </div>
  );
}

function Row({ name, used, stopAt, limit, note }: { name: string; used: number; stopAt: number; limit: number; note: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{name}</span>
        <span className="tabular-nums text-[var(--muted)]">
          {used.toLocaleString()} / {stopAt.toLocaleString()}
        </span>
      </div>
      <Bar used={used} stopAt={stopAt} limit={limit} />
      <p className="mt-1 text-xs text-[var(--muted)]">{note}</p>
    </div>
  );
}

const MODE = {
  gemini: { dot: "bg-emerald-400", text: "Using Gemini", cls: "text-emerald-300" },
  backup: { dot: "bg-cyan-400", text: "Gemini is out — using Groq", cls: "text-cyan-300" },
  out: { dot: "bg-red-400", text: "All free AI used for now", cls: "text-red-300" },
} as const;

/** Which AI the agent is on, how much of each free budget is used, and GitHub minutes. */
export function AiStatus({ data, compact = false }: { data: AiStatusData; compact?: boolean }) {
  const m = MODE[data.mode];
  const groq = data.backups.find((b) => b.name === "groq");
  if (compact)
    return (
      <Link href="/usage" className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:border-[var(--accent)]" title="Free-tier usage">
        <span className={`h-2 w-2 rounded-full ${m.dot}`} />
        <span className={m.cls}>{m.text}</span>
        <span>
          · Gemini {data.gemini.used}/{data.gemini.stopAt}
          {groq ? ` · Groq ${groq.used}/${groq.stopAt}` : ""}
        </span>
      </Link>
    );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${m.dot} ${data.mode !== "out" ? "animate-pulse" : ""}`} />
        <span className={`font-medium ${m.cls}`}>{m.text}</span>
      </div>
      <Row name="Gemini (today)" used={data.gemini.used} stopAt={data.gemini.stopAt} limit={data.gemini.limit} note={`${data.gemini.used >= data.gemini.stopAt ? "At its limit — " : ""}resets in ${data.gemini.resetsInH} h (midnight Pacific). Reads resume PDFs, chat.`} />
      {groq ? (
        <Row name="Groq (today)" used={groq.used} stopAt={groq.stopAt} limit={groq.limit} note={groq.used >= groq.stopAt ? "At its limit — requests come back gradually (about one every 90 s per model)." : "Main AI for application questions. Used requests come back gradually through the day."} />
      ) : (
        <p className="text-xs text-[var(--muted)]">No backup AI set up (add GROQ_API_KEY).</p>
      )}
      {data.minutes.unlimited ? (
        <p className="text-xs text-[var(--muted)]">GitHub minutes: unlimited (public repo).</p>
      ) : (
        <Row
          name="Agent run time (today)"
          used={data.minutes.usedToday}
          stopAt={Math.max(1, data.minutes.dayAllowance)}
          limit={Math.max(1, data.minutes.dayAllowance)}
          note={
            data.minutes.usedToday >= data.minutes.dayAllowance
              ? `Today's share is used — scheduled runs resume in ${data.minutes.resetsInH} h. Run now still works. (${data.minutes.usedMonth}/${data.minutes.stopAt} this month)`
              : `${data.minutes.usedMonth}/${data.minutes.stopAt} minutes this month, spread over the days left; new share in ${data.minutes.resetsInH} h. Run now always works.`
          }
        />
      )}
    </div>
  );
}
