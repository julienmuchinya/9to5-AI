"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  actions?: { tool: string; result: Record<string, unknown> }[];
}
interface Conversation {
  id: string;
  title: string;
  updated_at: string | null;
  count: number;
}

const SUGGESTIONS = [
  "What's my status?",
  "Why are so few applications going out?",
  "Look for new jobs and start applying",
  "Show my freshest verified matches",
  "Apply to all verified backend internships",
  "What's waiting on me?",
  "Retry everything that failed",
  "Only look for remote jobs paying $90k+",
];

const TOOL_LABEL: Record<string, string> = {
  get_status: "Checked status",
  explain_last_run: "Looked at the last run",
  search_jobs: "Searched jobs",
  queue_applications: "Queued applications",
  list_applications: "Listed applications",
  retry_applications: "Re-queued applications",
  answer_question: "Saved your answer",
  update_applications: "Updated applications",
  dismiss_jobs: "Dismissed jobs",
  update_preferences: "Updated preferences",
  set_autopilot: "Changed autopilot",
  run_agent_now: "Started a run",
  get_profile: "Read your profile",
  job_match_report: "Checked the match",
  follow_ups: "Found quiet applications",
};

/** The number a tool reports, for the little "✓ Queued applications: 12" chip. */
function chipCount(result: Record<string, unknown> | undefined): string {
  if (!result) return "";
  for (const k of ["queued", "requeued", "updated", "dismissed"]) if (typeof result[k] === "number") return `: ${result[k]}`;
  if (result.error) return " — not done";
  return "";
}

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

const when = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [legacy, setLegacy] = useState(false);
  /** null = a new chat that hasn't been sent to yet. */
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const d = await fetch("/api/chat", { cache: "no-store" }).then((r) => r.json());
      const list: Conversation[] = Array.isArray(d.conversations) ? d.conversations : [];
      setConversations(list);
      setLegacy(Boolean(d.legacy));
      return list;
    } catch {
      return [];
    }
  }, []);

  const open = useCallback(async (id: string | null) => {
    setCurrent(id);
    setHistoryOpen(false);
    setLoaded(false);
    if (!id) {
      setMessages([]);
      setLoaded(true);
      box.current?.focus();
      return;
    }
    try {
      const d = await fetch(`/api/chat?conversation=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json());
      setMessages(Array.isArray(d.messages) ? d.messages : []);
    } catch {
      setMessages([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  // First visit: continue the latest conversation, or start fresh.
  useEffect(() => {
    loadConversations().then((list) => open(list[0]?.id ?? null));
  }, [loadConversations, open]);
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
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: t, conversation_id: current ?? undefined }) });
      if (res.status === 401) {
        window.location.href = "/login?next=/chat&error=" + encodeURIComponent("Your session expired. Sign in again to keep chatting.");
        return;
      }
      const d = await res.json().catch(() => ({ error: `The server had a problem (${res.status}). Try again in a minute.` }));
      const content = typeof d.reply === "string" ? d.reply : typeof d.error === "string" ? d.error : "No reply";
      setMessages((m) => [...m, { role: "assistant", content, actions: Array.isArray(d.actions) ? d.actions : [] }]);
      if (typeof d.conversation_id === "string" && d.conversation_id !== current) setCurrent(d.conversation_id);
      loadConversations();
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Network error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this chat? The agent keeps everything it did (queued jobs, answers, settings).")) return;
    await fetch(`/api/chat?conversation=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    const list = await loadConversations();
    if (id === current) open(list[0]?.id ?? null);
  }

  const title = conversations.find((c) => c.id === current)?.title ?? "New chat";

  const history = (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={() => open(null)}
        disabled={current === null && messages.length === 0}
        className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        <span aria-hidden>+</span> New chat
      </button>
      {legacy && <p className="mb-2 text-[11px] leading-snug text-[var(--muted)]">Chat history needs the database update in supabase/migrations/007 — until then all messages share one chat.</p>}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {conversations.length === 0 && <p className="px-2 py-3 text-xs text-[var(--muted)]">No chats yet.</p>}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm transition ${c.id === current ? "bg-[var(--accent-soft)] text-[var(--foreground)]" : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"}`}
          >
            <button type="button" onClick={() => open(c.id)} className="min-w-0 flex-1 text-left" title={c.title}>
              <span className="block truncate">{c.title}</span>
              <span className="block text-[11px] opacity-70">
                {when(c.updated_at)}
                {c.count ? ` · ${c.count} messages` : ""}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Delete chat "${c.title}"`}
              title="Delete chat"
              onClick={() => remove(c.id)}
              className="rounded-md px-1.5 py-0.5 text-xs opacity-0 transition hover:bg-[var(--card)] hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] max-w-5xl flex-col md:h-[calc(100dvh-4rem)]">
      <PageHeader title="Chat with your agent" description="Tell it what to look for, what to apply to, what to retry, or answer its questions. It acts on your account only." />
      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="hidden w-60 shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-[var(--shadow)] md:block">{history}</aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2 md:hidden">
            <button type="button" onClick={() => setHistoryOpen((v) => !v)} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm" aria-expanded={historyOpen}>
              {historyOpen ? "Close history" : "Chats"}
            </button>
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">{title}</span>
            <button type="button" onClick={() => open(null)} className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white">
              + New
            </button>
          </div>
          {historyOpen && <div className="mb-2 max-h-72 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-[var(--shadow)] md:hidden">{history}</div>}
          <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow)] sm:p-5">
            {loaded && messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-2xl">✦</div>
                <p className="font-medium">What should your agent do?</p>
                <p className="mb-5 mt-1 text-sm text-[var(--muted)]">Ask about jobs, queue or retry applications, answer its questions, or change what it looks for.</p>
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
                        <span key={j} className={`rounded-full px-2 py-0.5 text-[11px] ${a.result?.error ? "bg-amber-500/15 text-amber-400" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>
                          {a.result?.error ? "•" : "✓"} {TOOL_LABEL[a.tool] ?? a.tool}
                          {chipCount(a.result)}
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
              ref={box}
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="e.g. Retry the Samsung applications, or: Answer 'highest clearance' with None"
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
      </div>
    </div>
  );
}
