import { APP_QUESTIONS, APP_QUESTION_GROUPS, type AppAnswers } from "@/lib/v2/app-questions";
import { inputCls } from "@/components/ui";

/** Profile section: answers to questions almost every application asks. Saved by saveProfile. */
export function CommonQuestions({ answers }: { answers: AppAnswers }) {
  const answered = APP_QUESTIONS.filter((q) => answers[q.key]?.trim()).length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">
          The agent copies these straight into application forms — no AI needed, so it’s faster and free. Leave anything blank and the agent
          either picks “decline to answer” (for voluntary questions) or hands that job to you.
        </p>
        <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
          {answered}/{APP_QUESTIONS.length} answered
        </span>
      </div>
      {APP_QUESTION_GROUPS.map((g) => (
        <fieldset key={g}>
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{g}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {APP_QUESTIONS.filter((q) => q.group === g).map((q) => (
              <label key={q.key} className="block text-sm">
                {q.label}
                {q.options ? (
                  <select name={`aq_${q.key}`} defaultValue={answers[q.key] ?? ""} className={inputCls}>
                    <option value="">Not set</option>
                    {q.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input name={`aq_${q.key}`} defaultValue={answers[q.key] ?? ""} placeholder={q.placeholder} className={inputCls} />
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
