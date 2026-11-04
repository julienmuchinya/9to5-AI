"use client";

import { useState } from "react";
import { inputCls } from "@/components/security-questions";
import { changePassword } from "../auth-actions";

export function ChangePasswordForm() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (mismatch) return;
        setBusy(true);
        const r = await changePassword(pw);
        setMsg(r);
        setBusy(false);
        if (r.ok) {
          setPw("");
          setPw2("");
        }
      }}
    >
      <input className={inputCls} type="password" placeholder="New password (8+ characters, letters and numbers)" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" />
      <input className={inputCls} type="password" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required autoComplete="new-password" />
      {mismatch && <p className="text-sm text-red-400">Passwords don’t match.</p>}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.message}</p>}
      <button disabled={busy || mismatch} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}
