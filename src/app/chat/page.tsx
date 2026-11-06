"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  actions?: { tool: string; result: Record<string, unknown> }[];
}

const SUGGESTIONS = [
  "What's my status?",
  "Show my freshest verified matches",
  "Apply to all verified backend internships",
  "Only look for remote jobs paying $90k+",
  "Turn on auto-submit with a cap of 20 a day",
  "Run the agent now",
];

const TOOL_LABEL: Record<string, string> = {
  get_status: "Checked status",
  search_jobs: "Searched jobs",
  queue_applications: "Queued applications",
  update_preferences: "Updated preferences",
  set_autopilot: "Changed autopilot",
  run_agent_now: "Started a run",
  get_profile: "Read your profile",
};

/** **bold** and line breaks / bullet lists — enough for the agent's short replies, no HTML injection. */
function Rich({ text }: { text: string }): ReactNode {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
    );
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      out.push(
        <ul key={`l${out.length}`} className="my-1 list-disc space-y-0.5 pl-5">
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>
      );
    list = [];
  };
  for (const l of lines) {
    const m = l.match(/^\s*[-*•]\s+(.*)/);
    if (m) list.push(m[1]);
    else {
      flush();
      out.push(l.trim() ? <p key={`p${out.length}`}>{inline(l)}</p> : <div key={`b${out.length}`} className="h-2" />);
    }
  }
  flush();
  return <div className="space-y-1">{out}</div>;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d) => setMessages(Array.isArray(d.messages) ? d.messages : []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  // Block body on purpose: scrollIntoView() returns a Promise in newer browsers, and an
  // effect must return nothing or a cleanup function — returning the Promise crashed the page.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

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
      const content = typeof d.reply === "string" ? d.reply : typeof d.error === "string" ? d.error : "No reply";
      setMessages((m) => [...m, { role: "assistant", content, actions: Array.isArray(d.actions) ? d.actions : [] }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Network error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] max-w-3xl flex-col md:h-[calc(100dvh-4rem)]">
      <PageHeader title="Chat with your agent" description="Tell it what to look for or apply to. It acts on your account only." />
      <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow)] sm:p-5">
        {loaded && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-2xl">✦</div>
            <p className="font-medium">What should your agent do?</p>
            <p className="mb-5 mt-1 text-sm text-[var(--muted)]">Ask about jobs, queue applications, or change what it looks for.</p>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs text-[var(--accent)]">AI</div>}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user" ? "rounded-br-md bg-[var(--accent)] text-white" : "rounded-bl-md border border-[var(--border)] bg-[var(--background)]"
              }`}
            >
              {m.actions?.length ? (
                <div className="mb-2 flex flex-wrap gap-1">
                  {m.actions.map((a, j) => (
                    <span key={j} className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] text-[var(--accent)]">
                      ✓ {TOOL_LABEL[a.tool] ?? a.tool}
                      {typeof a.result?.queued === "number" ? `: ${a.result.queued}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
              {m.role === "assistant" ? <Rich text={String(m.content ?? "")} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-soft)] text-xs text-[var(--accent)]">AI</div>
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)] [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)] [animation-delay:300ms]" />
            </span>
            Working on it…
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-[var(--shadow)] focus-within:border-[var(--accent)]"
      >
        <textarea
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="e.g. Apply to every verified data engineering new-grad job"
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
        />
        <button
          disabled={busy || !input.trim()}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
