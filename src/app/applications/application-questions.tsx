import Link from "next/link";
import { Card, inputCls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { PendingQuestion } from "@/lib/v2/app-questions";
import { sensitiveField } from "@/lib/v2/sensitive";
import { answerPendingQuestions } from "../actions";

export interface StuckApplication {
  id: string;
  company: string;
  title: string;
  /** Everything the agent already filled in on this form, in form order: question → answer. */
  answered: [string, string][];
  /** The questions it couldn't answer, with their full text and choices. */
  open: PendingQuestion[];
  /** How many other waiting applications ask the same questions (they're answered too). */
  alsoAsking: number;
}

/**
 * Needs you, one application at a time: the whole form as the agent filled it (every question and its answer, so
 * the question it's stuck on makes sense), then every question it needs you for — all of them for that
 * application, together. An answer is saved for every application that asks the same question.
 */
export function ApplicationQuestions({ apps }: { apps: StuckApplication[] }) {
  if (!apps.length) return null;
  const total = apps.reduce((n, a) => n + a.open.length, 0);
  return (
    <div id="questions" className="mb-6 scroll-mt-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold">
          {apps.length} application{apps.length === 1 ? "" : "s"} waiting on {total} answer{total === 1 ? "" : "s"} from you
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Each card shows everything the agent already filled in on that form, then the questions it needs you for. Your answer is saved and reused on any similar question, and these applications go back in the queue.
        </p>
      </div>
      {apps.map((a) => (
        <Card key={a.id} className="border-amber-400/30 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">
              {a.company} <span className="font-normal text-[var(--muted)]">— {a.title}</span>
            </h3>
            <Link href={`/applications?tab=needs&app=${a.id}`} className="text-xs underline underline-offset-4">
              Open application
            </Link>
          </div>
          {a.answered.length > 0 && (
            <details className="mt-3 rounded-lg border border-[var(--border)] p-3" open={a.answered.length <= 10}>
              <summary className="cursor-pointer text-sm font-medium">What the agent already answered on this form ({a.answered.length})</summary>
              <ol className="mt-2 space-y-1.5 text-sm">
                {a.answered.map(([q, ans], i) => (
                  <li key={i} className="grid gap-0.5 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-3">
                    <span className="text-[var(--muted)]">{q}</span>
                    <span className="font-medium break-words">{ans}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <form action={answerPendingQuestions} className="mt-3 space-y-3">
            <p className="text-sm font-semibold text-amber-300">Stuck here — {a.open.length} question{a.open.length === 1 ? "" : "s"} for you:</p>
            {a.open.map((q) => (
              <QuestionField key={q.key} q={q} />
            ))}
            {a.alsoAsking > 0 && <p className="text-xs text-[var(--muted)]">Also answers the same question{a.open.length === 1 ? "" : "s"} on {a.alsoAsking} other waiting application{a.alsoAsking === 1 ? "" : "s"}.</p>}
            <SubmitButton>Save answers & reapply</SubmitButton>
          </form>
        </Card>
      ))}
    </div>
  );
}

function QuestionField({ q }: { q: PendingQuestion }) {
  const name = `pq_${q.key}`;
  const opts = (q.options ?? []).filter(Boolean);
  const secret = sensitiveField(q.label, q.kind);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--background-2)] p-3">
      {q.context?.length ? (
        <p className="mb-2 border-l-2 border-[var(--border-strong)] pl-3 text-xs text-[var(--muted)]">
          Follows:{" "}
          {q.context.map((x, i) => (
            <span key={i}>
              {i > 0 ? " then " : ""}“{x.label}”{x.answer ? <> — answered <span className="text-[var(--foreground)]">“{x.answer}”</span></> : ""}
            </span>
          ))}
        </p>
      ) : null}
      <label htmlFor={opts.length > 6 || !opts.length ? name : undefined} className="block text-sm font-medium">
        {q.label}
      </label>
      {secret ? (
        <p className="mt-2 text-sm text-red-400">
          🔒 This asks for {secret.what}. The agent never fills that in or sends it to an AI, and you shouldn’t type it here.
          {secret.level === "scam" ? " Real employers don’t ask for it on an application — likely a scam." : " If you trust the employer, open the application and enter it there yourself."}
        </p>
      ) : (
        <>
          <input type="hidden" name={`pl_${q.key}`} value={q.label} />
          <div className="mt-2">
            {q.kind === "checkboxes" && opts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {opts.map((o) => (
                  <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
                    <input type="checkbox" name={name} value={o} className="accent-[var(--accent)]" />
                    {o}
                  </label>
                ))}
              </div>
            ) : opts.length > 0 && opts.length <= 6 ? (
              <div className="flex flex-wrap gap-2">
                {opts.map((o) => (
                  <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
                    <input type="radio" name={name} value={o} className="accent-[var(--accent)]" />
                    {o}
                  </label>
                ))}
              </div>
            ) : opts.length > 6 ? (
              <select id={name} name={name} defaultValue="" className={inputCls}>
                <option value="">Choose…</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : q.kind === "textarea" ? (
              <textarea id={name} name={name} rows={3} className={inputCls} placeholder="Your answer" />
            ) : (
              <input id={name} name={name} className={inputCls} placeholder="Your answer" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
