import { Card, inputCls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { isFollowUp, type PendingQuestion } from "@/lib/v2/app-questions";
import { sensitiveField } from "@/lib/v2/sensitive";
import { answerPendingQuestions } from "../actions";

export interface AskedQuestion extends PendingQuestion {
  /** Companies whose application is waiting on this question. */
  companies: string[];
  /** For a follow-up ("If yes, please explain"): the question(s) it follows on each company's form. */
  contexts: { company: string; context: NonNullable<PendingQuestion["context"]> }[];
  /** One application that asks it (to open the form when there's no context saved). */
  appId?: string;
}

/** One form for every question the agent couldn't answer, deduplicated across applications. */
export function PendingQuestions({
  questions,
}: {
  questions: AskedQuestion[];
}) {
  if (!questions.length) return null;
  const waiting = new Set(questions.flatMap((q) => q.companies)).size;
  return (
    <div id="questions" className="scroll-mt-6">
      <Card className="mb-6 border-amber-400/30 bg-gradient-to-br from-amber-400/[0.07] to-transparent">
        <div className="mb-4">
          <h2 className="text-base font-semibold">
            {questions.length} question{questions.length === 1 ? "" : "s"} the
            agent needs you to answer
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Applications to {waiting} compan{waiting === 1 ? "y" : "ies"} are
            waiting on these. Answer once — the agent saves each answer, reuses
            it on any similar question in future forms, and puts these
            applications back in the queue. Leave a question blank to skip it
            for now.
          </p>
        </div>
        <form action={answerPendingQuestions} className="space-y-4">
          {questions.map((q) => {
            const name = `pq_${q.key}`;
            const opts = q.options.filter(Boolean);
            const secret = sensitiveField(q.label, q.kind);
            if (secret)
              return (
                <div key={q.key} className="rounded-xl border border-red-400/40 bg-red-400/[0.06] p-3">
                  <p className="text-sm font-medium">{q.label}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Asked by {q.companies.slice(0, 4).join(", ")}
                    {q.companies.length > 4 ? ` and ${q.companies.length - 4} more` : ""}
                  </p>
                  <p className="mt-2 text-sm text-red-400">
                    🔒 This asks for {secret.what}. The agent never fills that in or sends it to an AI, and you shouldn’t type it here either.
                    {secret.level === "scam"
                      ? " Real employers don’t ask for it on an application — treat this posting as a likely scam."
                      : " If you trust the employer, open the application on their site and enter it there yourself."}
                  </p>
                </div>
              );
            return (
              <div
                key={q.key}
                className="rounded-xl border border-[var(--border)] bg-[var(--background-2)] p-3"
              >
                <input type="hidden" name={`pl_${q.key}`} value={q.label} />
                {q.contexts.length > 0 ? (
                  <div className="mb-2 border-l-2 border-[var(--border-strong)] pl-3 text-xs text-[var(--muted)]">
                    {q.contexts.slice(0, 3).map((c) => (
                      <p key={c.company} className="mt-0.5">
                        <span className="font-semibold text-[var(--foreground)]">{c.company}</span> asked first:{" "}
                        {c.context.map((x, i) => (
                          <span key={i}>
                            {i > 0 ? " then " : ""}“{x.label}”{x.answer ? <> — answered <span className="text-[var(--foreground)]">“{x.answer}”</span></> : ""}
                          </span>
                        ))}
                      </p>
                    ))}
                    <p className="mt-1">So this question is about that.</p>
                  </div>
                ) : isFollowUp(q.label) ? (
                  <p className="mb-2 border-l-2 border-[var(--border-strong)] pl-3 text-xs text-[var(--muted)]">
                    This follows another question on the form, which wasn’t saved for this application.{" "}
                    {q.appId && (
                      <Link href={`/applications?tab=needs&app=${q.appId}`} className="font-semibold underline underline-offset-4">
                        Open the application to see it
                      </Link>
                    )}
                  </p>
                ) : null}
                <label
                  htmlFor={opts.length > 6 || !opts.length ? name : undefined}
                  className="block text-sm font-medium"
                >
                  {q.label}
                </label>
                <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">
                  Asked by {q.companies.slice(0, 4).join(", ")}
                  {q.companies.length > 4
                    ? ` and ${q.companies.length - 4} more`
                    : ""}
                </p>
                {q.kind === "checkboxes" && opts.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {opts.map((o) => (
                      <label
                        key={o}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm transition hover:border-[var(--border-strong)] has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]"
                      >
                        <input type="checkbox" name={name} value={o} className="accent-[var(--accent)]" />
                        {o}
                      </label>
                    ))}
                  </div>
                ) : opts.length > 0 && opts.length <= 6 ? (
                  <div className="flex flex-wrap gap-2">
                    {opts.map((o) => (
                      <label
                        key={o}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm transition hover:border-[var(--border-strong)] has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]"
                      >
                        <input
                          type="radio"
                          name={name}
                          value={o}
                          className="accent-[var(--accent)]"
                        />
                        {o}
                      </label>
                    ))}
                  </div>
                ) : opts.length > 6 ? (
                  <select
                    id={name}
                    name={name}
                    defaultValue=""
                    className={inputCls}
                  >
                    <option value="">Choose…</option>
                    {opts.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : q.kind === "textarea" ? (
                  <textarea
                    id={name}
                    name={name}
                    rows={3}
                    className={inputCls}
                    placeholder="Your answer"
                  />
                ) : (
                  <input
                    id={name}
                    name={name}
                    className={inputCls}
                    placeholder="Your answer"
                  />
                )}
              </div>
            );
          })}
          <SubmitButton>Save answers & reapply</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
