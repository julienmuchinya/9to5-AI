import { Card, inputCls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { PendingQuestion } from "@/lib/v2/app-questions";
import { answerPendingQuestions } from "../actions";

export interface AskedQuestion extends PendingQuestion {
  /** Companies whose application is waiting on this question. */
  companies: string[];
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
            return (
              <div
                key={q.key}
                className="rounded-xl border border-[var(--border)] bg-[var(--background-2)] p-3"
              >
                <input type="hidden" name={`pl_${q.key}`} value={q.label} />
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
