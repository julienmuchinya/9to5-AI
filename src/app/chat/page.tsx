"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  actions?: { tool: string; result: Record<string, unknown> }[];
}

const SUGGESTIONS = [
  "What's my status?",
  "Show my best verified matches",
  "Apply to all verified backend internships",
  "Only look for remote jobs paying $90k+",
  "Turn on auto-submit with a cap of 5 a day",
];

const TOOL_LABEL: Record<string, string> = {
  get_status: "Checked status",
  search_jobs: "Searched jobs",
  queue_applications: "Queued applications",
  update_preferences: "Updated preferences",
  set_autopilot: "Changed autopilot",
  run_agent_now: "Started a run",
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [messages, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: t }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: t }) });
      if (res.status === 401) {
        window.location.href = "/login?next=/chat&error=" + encodeURIComponent("Your session expired. Sign in again to keep chatting.");
        return;
      }
      const d = await res.json().catch(() => ({ error: `The server had a problem (${res.status}). Try again in a minute.` }));
      setMessages((m) => [...m, { role: "assistant", content: d.reply ?? d.error ?? "No reply", actions: d.actions }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Network error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-3xl flex-col">
      <PageHeader title="Chat with your agent" description="Tell it what to look for or apply to. It acts on your account only." />
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        {messages.length === 0 && (
          <div className="text-sm text-[var(--muted)]">
            <p className="mb-3">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-[var(--border)] px-3 py-1 hover:border-[var(--accent)] hover:text-[var(--foreground)]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-4 py-2 text-sm ${m.role === "user" ? "bg-[var(--accent)] text-white" : "bg-[var(--background)]"}`}>
              {m.actions?.length ? (
                <div className="mb-1 flex flex-wrap gap-1">
                  {m.actions.map((a, j) => (
                    <span key={j} className="rounded-full bg-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                      {TOOL_LABEL[a.tool] ?? a.tool}
                      {typeof a.result?.queued === "number" ? `: ${a.result.queued}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-[var(--muted)]">Agent is working…</p>}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Apply to every verified data engineering new-grad job"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button disabled={busy || !input.trim()} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}
