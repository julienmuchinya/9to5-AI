"use client";

import { useState } from "react";

export function ResumeUpload({ hasResume, updatedAt }: { hasResume: boolean; updatedAt: string | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append("resume", file);
    try {
      const res = await fetch("/api/resume", { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Upload failed");
      setMsg({
        ok: true,
        text: `Read your resume: ${d.skills} skills, ${d.experience} jobs, ${d.projects} projects. Suggested roles: ${(d.target_roles ?? []).join(", ") || "—"}.`,
      });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <label className="inline-flex cursor-pointer items-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">
        {busy ? "Reading your resume…" : hasResume ? "Replace resume (PDF)" : "Upload resume (PDF)"}
        <input type="file" accept="application/pdf" className="hidden" onChange={onChange} disabled={busy} />
      </label>
      {hasResume && (
        <a href="/api/resume" className="ml-3 text-sm text-[var(--accent)] hover:underline">
          View current resume
        </a>
      )}
      {updatedAt && <p className="mt-2 text-xs text-[var(--muted)]">Last uploaded {new Date(updatedAt).toLocaleString()}</p>}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
