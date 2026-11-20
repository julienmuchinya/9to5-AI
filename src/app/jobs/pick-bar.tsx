"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

const boxes = (formId: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=pick][form="${formId}"]`)).filter((b) => !b.disabled);

/**
 * The bar above search results: how many are ticked, Select all / Clear, and the two actions —
 * "Apply with agent" (queue them and start a run) or "Queue for later". Sticks to the top while scrolling.
 */
export function PickBar({ formId, total }: { formId: string; total: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(boxes(formId).filter((b) => b.checked).length);
    update();
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, [formId]);
  const setAll = (on: boolean) => {
    // At most 50 at once (the agent applies to them over the next runs).
    boxes(formId).forEach((b, i) => (b.checked = on && i < 50));
    setCount(boxes(formId).filter((b) => b.checked).length);
  };
  if (!total) return null;
  return (
    <div className="sticky top-[66px] z-20 flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--background)]/95 px-3 py-3 backdrop-blur md:top-[76px]">
      <span className="mr-auto text-sm" aria-live="polite">
        {count ? (
          <>
            <span className="font-semibold">{count}</span> selected
          </>
        ) : (
          <span className="text-[var(--muted)]">Tick jobs to apply to several at once</span>
        )}
      </span>
      <button type="button" onClick={() => setAll(count < Math.min(50, total))} className="min-h-[40px] px-2 text-sm font-semibold underline underline-offset-4">
        {count < Math.min(50, total) ? `Select all${total > 50 ? " (first 50)" : ""}` : "Clear selection"}
      </button>
      {count > 0 && count < Math.min(50, total) && (
        <button type="button" onClick={() => setAll(false)} className="min-h-[40px] px-2 text-sm text-[var(--muted)] underline-offset-4 hover:underline">
          Clear
        </button>
      )}
      <Submit disabled={!count} then="queue" className="min-h-[40px] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-sm font-semibold hover:border-[var(--foreground)]" busy="Queuing…">
        Queue for later
      </Submit>
      <Submit disabled={!count} then="apply" className="min-h-[40px] bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]" busy="Starting…">
        Apply with agent{count ? ` (${count})` : ""}
      </Submit>
    </div>
  );
}

function Submit({ then, disabled, className, busy, children }: { then: string; disabled: boolean; className: string; busy: string; children: React.ReactNode }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("then") === then;
  return (
    <button type="submit" name="then" value={then} disabled={disabled || pending} className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}>
      {mine ? busy : children}
    </button>
  );
}
