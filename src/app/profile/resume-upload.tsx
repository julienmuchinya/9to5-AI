"use client";

import { useState } from "react";

export function ResumeUpload({ hasResume, hasParsed, updatedAt }: { hasResume: boolean; hasParsed: boolean; updatedAt: string | null }) {
  const [busy, setBusy] = useState<null | "upload" | "reread">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; retry?: boolean } | null>(null);

  async function send(file?: File) {
    setBusy(file ? "upload" : "reread");
    setMsg(null);
    const form = new FormData();
    if (file) form.append("resume", file);
    try {
      const res = await fetch("/api/resume", { method: "POST", body: form });
      if (res.status === 401) {
        window.location.href = "/login?next=/profile&error=" + encodeURIComponent("Your session expired. Sign in again.");
        return;
      }
      const d = await res.json().catch(() => ({ error: `The server took too long or crashed (${res.status}). Try “Read it again” in a minute.`, retry: true }));
      if (!res.ok) {
        setMsg({ ok: false, text: d.error ?? "Upload failed", retry: d.retry || d.saved });
        if (d.saved) setTimeout(() => window.location.reload(), 4000);
        return;
      }
      setMsg({
        ok: true,
        text: `Read your resume: ${d.skills} skills, ${d.experience} jobs, ${d.projects} projects. Suggested roles: ${(d.target_roles ?? []).join(", ") || "—"}. Refreshing…`,
      });
      setTimeout(() => window.location.reload(), 1800);
    } catch (err) {
      setMsg({ ok: false, text: `Network problem: ${(err as Error).message}. Check your connection and try again.`, retry: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`inline-flex cursor-pointer items-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy === "upload" ? "Reading your resume… (up to a minute)" : hasResume ? "Replace resume (PDF)" : "Upload resume (PDF)"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={Boolean(busy)}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) send(f);
            }}
          />
        </label>
        {hasResume && (
          <button type="button" onClick={() => send()} disabled={Boolean(busy)} className="rounded-lg bg-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
            {busy === "reread" ? "Reading…" : "Read it again"}
          </button>
        )}
        {hasResume && (
          <a href="/api/resume" target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--accent)] hover:underline">
            View current resume
          </a>
        )}
      </div>
      {hasResume && !hasParsed && !msg && (
        <p className="mt-2 rounded-lg bg-amber-900/30 p-2 text-sm text-amber-300">
          Your PDF is saved but hasn’t been read yet, so the agent can’t match jobs. Click “Read it again”.
        </p>
      )}
      {updatedAt && <p className="mt-2 text-xs text-[var(--muted)]">Last uploaded {new Date(updatedAt).toLocaleString()}</p>}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
