"use client";

import { useState, useTransition } from "react";
import { deleteApplicationAnswer, saveApplicationAnswer } from "../actions";

type Msg = { ok: boolean; message: string } | null;
const field =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";
const btn = "min-h-[36px] rounded-lg px-3 text-xs font-medium transition disabled:opacity-50";

/** One answer: shows it, or an inline form to edit it (and optionally rename the question). */
function AnswerRow({ appId, q, a, jobSpecific }: { appId: string; q: string; a: string; jobSpecific: boolean }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(q);
  const [answer, setAnswer] = useState(a);
  const [remember, setRemember] = useState(!jobSpecific);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  if (!editing)
    return (
      <div className="group rounded-lg bg-[var(--background-2)] p-2.5">
        <dt className="text-xs text-[var(--muted)]">{q}</dt>
        <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm">{a}</dd>
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" className={`${btn} border border-[var(--border)] hover:border-[var(--border-strong)]`} onClick={() => setEditing(true)} aria-label={`Edit answer to: ${q}`}>
            Edit
          </button>
          <button
            type="button"
            disabled={pending}
            className={`${btn} text-red-400 hover:bg-red-400/10`}
            aria-label={`Delete answer to: ${q}`}
            onClick={() => {
              if (!window.confirm("Delete this answer from the application?")) return;
              start(async () => setMsg(await deleteApplicationAnswer(appId, q)));
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
          {msg && !msg.ok && <span className="self-center text-xs text-red-400">{msg.message}</span>}
        </div>
      </div>
    );

  return (
    <form
      className="space-y-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--background-2)] p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveApplicationAnswer(appId, { question, answer, oldQuestion: q, remember });
          setMsg(r);
          if (r.ok) setEditing(false);
        });
      }}
    >
      <label className="block text-xs text-[var(--muted)]">
        Question
        <input className={`${field} mt-1`} value={question} onChange={(e) => setQuestion(e.target.value)} required />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        Answer
        <textarea className={`${field} mt-1 min-h-[80px]`} value={answer} onChange={(e) => setAnswer(e.target.value)} required autoFocus />
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5" />
        <span>
          Use this answer on every application that asks this question
          {jobSpecific && <span className="block text-[var(--muted)]">This looks specific to this company — usually leave it off.</span>}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button disabled={pending} className={`${btn} bg-[var(--accent)] text-white`}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={`${btn} border border-[var(--border)]`}
          onClick={() => {
            setEditing(false);
            setQuestion(q);
            setAnswer(a);
            setMsg(null);
          }}
        >
          Cancel
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.message}</span>}
      </div>
    </form>
  );
}

/** The answers the agent prepared for one application, editable. */
export function AnswersEditor({ appId, answers, company }: { appId: string; answers: [string, string][]; company: string }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const jobSpecific = (label: string) =>
    (company.length > 2 && label.toLowerCase().includes(company.toLowerCase())) || /why (do you|are you|this|our|us)|cover letter|tell us about|describe|interest(ed)? in/i.test(label);

  return (
    <div className="space-y-2">
      <dl className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
        {answers.map(([question, answer]) => (
          <AnswerRow key={question} appId={appId} q={question} a={answer} jobSpecific={jobSpecific(question)} />
        ))}
        {answers.length === 0 && <p className="text-xs text-[var(--muted)]">No answers saved on this application yet.</p>}
      </dl>
      {msg?.ok && <p className="text-xs text-emerald-400" role="status">{msg.message}</p>}
      {adding ? (
        <form
          className="space-y-2 rounded-lg border border-[var(--border)] p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveApplicationAnswer(appId, { question: q, answer: a, remember });
              setMsg(r);
              if (r.ok) {
                setAdding(false);
                setQ("");
                setA("");
              }
            });
          }}
        >
          <input className={field} placeholder="Question, e.g. Are you willing to travel?" value={q} onChange={(e) => setQ(e.target.value)} required autoFocus aria-label="Question" />
          <textarea className={`${field} min-h-[70px]`} placeholder="Your answer" value={a} onChange={(e) => setA(e.target.value)} required aria-label="Answer" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Use on every application that asks this
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button disabled={pending} className={`${btn} bg-[var(--accent)] text-white`}>
              {pending ? "Saving…" : "Save answer"}
            </button>
            <button type="button" className={`${btn} border border-[var(--border)]`} onClick={() => setAdding(false)}>
              Cancel
            </button>
            {msg && !msg.ok && <span className="text-xs text-red-400">{msg.message}</span>}
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${btn} border border-dashed border-[var(--border-strong)] text-[var(--accent-text)] hover:border-[var(--accent)]`}>
          + Add an answer
        </button>
      )}
    </div>
  );
}
