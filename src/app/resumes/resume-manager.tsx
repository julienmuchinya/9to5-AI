"use client";

import { useState } from "react";
import { buttonCls, inputCls } from "@/components/ui";

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.href = "/login?next=/resumes";
    return null;
  }
  const d = await res.json().catch(() => ({ error: `The server took too long (${res.status}). Try again in a minute.` }));
  if (!res.ok) throw new Error(d.error ?? "Something went wrong");
  return d;
}

/** Upload a resume: "main" replaces the profile resume, "new" adds one, an id replaces that one. */
export function UploadResume({ id, label, cta, canReread = true }: { id: string; label?: string; cta: string; canReread?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(label ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isNew = id === "new";

  async function send(file?: File) {
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    if (file) form.append("resume", file);
    form.append("id", id);
    if (name.trim()) form.append("label", name.trim());
    try {
      const d = await call("/api/resume", { method: "POST", body: form });
      if (!d) return;
      setMsg({ ok: true, text: `Read “${d.label}”: ${d.skills} skills, ${d.experience} jobs, ${d.projects} projects. Refreshing…` });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {isNew && (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it, e.g. AI / ML resume" className={`${inputCls} !mt-0 max-w-[16rem]`} maxLength={40} />
        )}
        <label className={`${buttonCls(isNew ? "primary" : "secondary", "sm")} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? "Reading… (up to a minute)" : cta}
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) send(f);
            }}
          />
        </label>
        {!isNew && canReread && (
          <button type="button" disabled={busy} onClick={() => send()} className={buttonCls("ghost", "sm")} title="Read the stored PDF again (picks up skill groups, bold phrases and your tagline)">
            Read it again
          </button>
        )}
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}

export function RenameDelete({ id, label, canDelete }: { id: string; label: string; canDelete: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {editing ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} !mt-0 max-w-[14rem]`} maxLength={40} autoFocus />
          <button type="button" className={buttonCls("secondary", "sm")} onClick={() => run(() => call("/api/resume", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, label: name }) }))}>
            Save
          </button>
          <button type="button" className={buttonCls("ghost", "sm")} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className={buttonCls("ghost", "sm")} onClick={() => setEditing(true)}>
          Rename
        </button>
      )}
      {canDelete && !editing && (
        <button
          type="button"
          className={buttonCls("ghost", "sm")}
          onClick={() => confirm(`Delete “${label}”? The PDF is removed and the agent stops using it.`) && run(() => call(`/api/resume?id=${id}`, { method: "DELETE" }))}
        >
          Delete
        </button>
      )}
      {err && <p className="w-full text-xs text-red-400">{err}</p>}
    </div>
  );
}
