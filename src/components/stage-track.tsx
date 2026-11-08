/**
 * Application progress as connected circles:
 * Submitted → In review → Screening → Interview → Decision (Offer ✓ / Rejected ✕).
 * "Reached" uses the current status and the timeline, so a rejection after an interview still shows
 * how far it got.
 */
const STEPS = ["Submitted", "In review", "Screening", "Interview", "Decision"] as const;

const INDEX: Record<string, number> = { submitted: 0, received: 1, under_review: 1, screening: 2, interview: 3, offer: 4, rejected: 4, withdrawn: 4 };

export function stageIndex(status: string): number {
  return INDEX[status] ?? -1;
}

export function StageTrack({ status, history = [] }: { status: string; history?: string[] }) {
  const current = stageIndex(status);
  if (current < 0) return null;
  const final = status === "offer" || status === "rejected" || status === "withdrawn";
  // Furthest stage before the decision (from the timeline), so "rejected after interview" shows the interview.
  const reachedBefore = Math.max(0, ...history.map(stageIndex).filter((i) => i >= 0 && i < 4), final ? 0 : current);
  const reached = final ? reachedBefore : current;
  const endTone = status === "offer" ? "bg-emerald-500 border-emerald-500" : status === "rejected" ? "bg-red-500 border-red-500" : "bg-slate-500 border-slate-500";

  return (
    <ol className="mt-3 flex items-start" aria-label={`Progress: ${status}`}>
      {STEPS.map((label, i) => {
        const isEnd = i === 4;
        const done = isEnd ? final : i <= reached;
        const isCurrent = !final && i === current;
        const line = i < 4 ? (final ? i < reached : i < current) : false;
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center text-center">
            {i < 4 && <span className={`absolute left-1/2 top-[9px] h-0.5 w-full ${line ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`} aria-hidden />}
            <span
              className={`relative z-10 grid h-[18px] w-[18px] place-items-center rounded-full border-2 text-[10px] font-bold leading-none text-white ${
                isEnd && final ? endTone : done ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border)] bg-[var(--card)]"
              } ${isCurrent ? "ring-4 ring-[var(--accent)]/25" : ""}`}
            >
              {isEnd && status === "offer" ? "✓" : isEnd && status === "rejected" ? "✕" : done && !isEnd ? "" : ""}
            </span>
            <span className={`mt-1 text-[10px] leading-tight ${isCurrent || (isEnd && final) ? "font-medium text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
              {isEnd && status === "offer" ? "Offer" : isEnd && status === "rejected" ? "Rejected" : isEnd && status === "withdrawn" ? "Withdrawn" : label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
