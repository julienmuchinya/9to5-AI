"use client";

import { useEffect, useState } from "react";
import { bulkApplications } from "../actions";

const ACTION_LABEL: Record<string, string> = {
  retry: "Retry / reapply",
  ignore: "Ignore (stop asking)",
  applied: "Mark as applied",
  rejected: "Mark rejected",
  withdrawn: "Withdraw",
  delete: "Delete",
};

/**
 * Act on several applications at once. Tick rows (checkboxes use form="bulk"), tick the whole page,
 * or pick "Select all N" to act on every application in the current view — every page, not just this one.
 */
export function BulkBar({
  back,
  sort,
  tab,
  why,
  total,
  shown,
  viewLabel,
}: {
  back: string;
  sort: string;
  tab: string;
  why: string;
  total: number;
  shown: number;
  viewLabel: string;
}) {
  const [count, setCount] = useState(0);
  const [all, setAll] = useState(false);
  const [action, setAction] = useState("retry");
  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[form="bulk"][name="ids"]'));

  useEffect(() => {
    const update = (e?: Event) => {
      const n = boxes().filter((b) => b.checked).length;
      setCount(n);
      // Unticking any row leaves "everything" mode.
      if (e && (e.target as HTMLInputElement | null)?.form?.id === "bulk" && (e.target as HTMLInputElement).name === "ids" && !(e.target as HTMLInputElement).checked) setAll(false);
    };
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, []);

  const tickPage = (on: boolean) => {
    boxes().forEach((b) => (b.checked = on));
    setCount(on ? boxes().length : 0);
    if (!on) setAll(false);
  };
  const selected = all ? total : count;
  const pageAllTicked = count > 0 && count === shown;

  return (
    <form
      id="bulk"
      action={bulkApplications}
      onSubmit={(e) => {
        const what = `${ACTION_LABEL[action].toLowerCase()} — ${selected} application${selected === 1 ? "" : "s"}${all ? ` (everything in ${viewLabel})` : ""}`;
        if (action === "delete" ? !window.confirm(`Delete ${selected} application${selected === 1 ? "" : "s"}? This can't be undone.`) : all && !window.confirm(`Apply “${what}”?`)) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="tab" value={tab} />
      <input type="hidden" name="why" value={why} />
      {all && <input type="hidden" name="scope" value="all" />}

      <span className="px-1 text-sm text-[var(--muted)]" role="status">
        {all ? (
          <>
            <b className="text-[var(--foreground)]">All {total}</b> in {viewLabel} selected
          </>
        ) : count ? (
          `${count} selected`
        ) : (
          "Select applications to act on several at once"
        )}
      </span>
      {!pageAllTicked && !all && (
        <button type="button" onClick={() => tickPage(true)} className="min-h-[36px] rounded-lg border border-[var(--border)] px-2.5 text-xs hover:border-[var(--border-strong)]">
          Select this page ({shown})
        </button>
      )}
      {!all && total > 0 && (
        <button
          type="button"
          onClick={() => {
            tickPage(true);
            setAll(true);
          }}
          className="min-h-[36px] rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-2.5 text-xs font-semibold text-[var(--accent-text)] hover:border-[var(--accent)]"
        >
          Select all {total} in {viewLabel}
        </button>
      )}
      {(count > 0 || all) && (
        <button type="button" onClick={() => tickPage(false)} className="min-h-[36px] rounded-lg border border-[var(--border)] px-2.5 text-xs hover:border-[var(--border-strong)]">
          Clear
        </button>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          Sort
          <select
            defaultValue={sort}
            onChange={(e) => {
              const u = new URL(window.location.href);
              u.searchParams.set("sort", e.target.value);
              u.searchParams.delete("msg");
              window.location.href = u.toString();
            }}
            className="min-h-[36px] rounded-lg border border-[var(--border)] bg-[var(--background-2)] px-2 text-xs text-[var(--foreground)]"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="company">Company A–Z</option>
            <option value="status">Status</option>
            <option value="posted">Freshest posting</option>
          </select>
        </label>
        <label className="sr-only" htmlFor="bulk-action">
          Action
        </label>
        <select
          id="bulk-action"
          name="action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          disabled={!selected}
          className="min-h-[36px] rounded-lg border border-[var(--border)] bg-[var(--background-2)] px-2 text-xs disabled:opacity-50"
        >
          {Object.entries(ACTION_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button disabled={!selected} className="min-h-[36px] rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-white disabled:opacity-40">
          Apply to {selected || "…"}
        </button>
      </div>
    </form>
  );
}
