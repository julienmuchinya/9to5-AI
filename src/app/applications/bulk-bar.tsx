"use client";

import { useEffect, useState } from "react";
import { bulkApplications } from "../actions";

/** Select several applications (checkboxes on each card use form="bulk") and apply one action to all. */
export function BulkBar({ back, sort }: { back: string; sort: string }) {
  const [count, setCount] = useState(0);
  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[form="bulk"][name="ids"]'));

  useEffect(() => {
    const update = () => setCount(boxes().filter((b) => b.checked).length);
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, []);

  const setAll = (on: boolean) => {
    boxes().forEach((b) => (b.checked = on));
    setCount(on ? boxes().length : 0);
  };

  return (
    <form
      id="bulk"
      action={bulkApplications}
      onSubmit={(e) => {
        const action = (e.currentTarget.elements.namedItem("action") as HTMLSelectElement | null)?.value;
        if (action === "delete" && !window.confirm(`Delete ${count} application${count === 1 ? "" : "s"}? This can't be undone.`)) e.preventDefault();
      }}
      className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 p-2.5 shadow-[var(--shadow)] backdrop-blur"
    >
      <input type="hidden" name="back" value={back} />
      <span className="px-1 text-sm text-[var(--muted)]">{count ? `${count} selected` : "Select applications to act on several at once"}</span>
      <button type="button" onClick={() => setAll(true)} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--border-strong)]">
        Select all on this page
      </button>
      {count > 0 && (
        <button type="button" onClick={() => setAll(false)} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--border-strong)]">
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
            className="rounded-lg border border-[var(--border)] bg-[var(--background-2)] px-2 py-1 text-xs text-[var(--foreground)]"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="company">Company A–Z</option>
            <option value="status">Status</option>
            <option value="posted">Freshest posting</option>
          </select>
        </label>
        <select name="action" defaultValue="retry" disabled={!count} className="rounded-lg border border-[var(--border)] bg-[var(--background-2)] px-2 py-1 text-xs disabled:opacity-50">
          <option value="retry">Retry / reapply</option>
          <option value="applied">Mark as applied</option>
          <option value="rejected">Mark rejected</option>
          <option value="withdrawn">Withdraw</option>
          <option value="delete">Delete</option>
        </select>
        <button disabled={!count} className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
          Apply to {count || "…"}
        </button>
      </div>
    </form>
  );
}
