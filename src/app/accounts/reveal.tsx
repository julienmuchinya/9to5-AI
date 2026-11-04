"use client";

import { useState } from "react";
import { revealPortalPassword } from "../vault-actions";

export function RevealPassword({ id }: { id: string }) {
  const [pw, setPw] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="rounded bg-[var(--background)] px-2 py-1 text-sm">{pw ?? "••••••••••••"}</code>
      {pw ? (
        <>
          <button
            type="button"
            className="rounded bg-[var(--border)] px-2 py-1 text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(pw);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="rounded bg-[var(--border)] px-2 py-1 text-xs" onClick={() => setPw(null)}>
            Hide
          </button>
        </>
      ) : (
        <button
          type="button"
          className="rounded bg-[var(--border)] px-2 py-1 text-xs"
          onClick={async () => {
            const r = await revealPortalPassword(id);
            if (r.password) setPw(r.password);
            else setErr(r.error ?? "Error");
          }}
        >
          Show
        </button>
      )}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}
