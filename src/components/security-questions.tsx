"use client";

import { useState } from "react";
import { SECURITY_QUESTIONS_LIST } from "@/lib/v2/questions";
import { saveSecurityQuestions } from "@/app/auth-actions";

export const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

export type QA = { q: string[]; a: string[] };

/** Three question pickers + answers. Controlled so the parent can submit them. */
export function SecurityQuestionsFields({ value, onChange }: { value: QA; onChange: (v: QA) => void }) {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1">
          <select
            className={inputCls}
            value={value.q[i]}
            onChange={(e) => {
              const q = [...value.q];
              q[i] = e.target.value;
              onChange({ ...value, q });
            }}
            required
          >
            <option value="">Question {i + 1}…</option>
            {SECURITY_QUESTIONS_LIST.map((q) => (
              <option key={q} value={q} disabled={value.q.includes(q) && value.q[i] !== q}>
                {q}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            placeholder="Your answer"
            value={value.a[i]}
            autoComplete="off"
            onChange={(e) => {
              const a = [...value.a];
              a[i] = e.target.value;
              onChange({ ...value, a });
            }}
            required
          />
        </div>
      ))}
      <p className="text-xs text-[var(--muted)]">
        Pick answers only you know and won’t forget. Capitals and punctuation don’t matter. Answers are stored one-way scrambled — nobody, including us, can read them.
      </p>
    </div>
  );
}

export function SecurityQuestionsEditor({ hasExisting }: { hasExisting: boolean }) {
  const [v, setV] = useState<QA>({ q: ["", "", ""], a: ["", "", ""] });
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await saveSecurityQuestions(v);
        setMsg(r);
        setBusy(false);
        if (r.ok) setV({ q: ["", "", ""], a: ["", "", ""] });
      }}
      className="space-y-3"
    >
      {hasExisting && <p className="text-sm text-emerald-400">✓ You have security questions set. Saving below replaces them.</p>}
      <SecurityQuestionsFields value={v} onChange={setV} />
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.message}</p>}
      <button disabled={busy} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Saving…" : "Save security questions"}
      </button>
    </form>
  );
}
