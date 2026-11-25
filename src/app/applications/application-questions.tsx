import Link from "next/link";
import { Card, inputCls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { FormRow } from "@/lib/v2/app-questions";
import { sensitiveField } from "@/lib/v2/sensitive";
import { saveApplicationForm } from "../actions";

export interface StuckApplication {
  id: string;
  company: string;
  title: string;
  /** The whole form in order (or, for older applications, the answers followed by the missing questions). */
  rows: FormRow[];
  /** True when `rows` is the real form order saved by the agent. */
  inOrder: boolean;
  /** How many other waiting applications ask the same missing questions (they're unblocked too). */
  alsoAsking: number;
}

/**
 * Needs you, one application at a time: the whole form as the agent left it — every question in order, its answer —
 * with the questions it's stuck on highlighted where they sit. Any answer can be changed, not only the missing ones;
 * a change is saved as your own answer and used on every application that asks the same question.
 */
export function ApplicationQuestions({ apps }: { apps: StuckApplication[] }) {
  if (!apps.length) return null;
  const total = apps.reduce((n, a) => n + a.rows.filter((r) => r.missing).length, 0);
  return (
    <div id="questions" className="mb-6 scroll-mt-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold">
          {apps.length} application{apps.length === 1 ? "" : "s"} waiting on {total} answer{total === 1 ? "" : "s"} from you
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Each card is the whole form as the agent filled it, top to bottom. The questions it needs you for are highlighted where they sit. You can change any answer — a change is saved as your own answer and used on every application that asks the same question.
        </p>
      </div>
      {apps.map((a) => {
        const missing = a.rows.filter((r) => r.missing).length;
        return (
          <Card key={a.id} className="scroll-mt-6 border-amber-400/30 p-4">
            <span id={`app-${a.id}`} />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                {a.company} <span className="font-normal text-[var(--muted)]">— {a.title}</span>
              </h3>
              <Link href={`/applications?tab=needs&app=${a.id}`} className="text-xs underline underline-offset-4">
                Open application
              </Link>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {a.rows.length} question{a.rows.length === 1 ? "" : "s"} · <span className="font-semibold text-amber-300">{missing} need{missing === 1 ? "s" : ""} you</span>
              {a.inOrder ? " · in the form's own order" : " · older application: answers first, then what's missing"}
              {a.alsoAsking > 0 ? ` · the same answers also unblock ${a.alsoAsking} other application${a.alsoAsking === 1 ? "" : "s"}` : ""}
            </p>
            <form action={saveApplicationForm} className="mt-3">
              <input type="hidden" name="app_id" value={a.id} />
              <input type="hidden" name="rows" value={a.rows.length} />
              <ol className="space-y-2">
                {a.rows.map((r, i) => (
                  <Row key={i} r={r} i={i} />
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <SubmitButton>Save answers & reapply</SubmitButton>
                <span className="text-xs text-[var(--muted)]">Only changed and newly filled answers are saved.</span>
              </div>
            </form>
          </Card>
        );
      })}
    </div>
  );
}

function Row({ r, i }: { r: FormRow; i: number }) {
  const name = `a_${i}`;
  const opts = r.options.filter(Boolean);
  const secret = sensitiveField(r.label, r.kind);
  const tone = r.missing ? "border-amber-400/60 bg-amber-400/[0.07]" : "border-[var(--border)] bg-[var(--background-2)]";
  const current = r.answer ?? "";
  const picked = new Set(current.split(/\s*,\s*/).filter(Boolean));
  return (
    <li className={`rounded-xl border p-3 ${tone}`}>
      <input type="hidden" name={`q_${i}`} value={r.label} />
      <input type="hidden" name={`o_${i}`} value={current} />
      <input type="hidden" name={`m_${i}`} value={r.missing ? "1" : "0"} />
      <input type="hidden" name={`r_${i}`} value={r.fromResume ? "1" : "0"} />
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={opts.length > 6 || !opts.length ? name : undefined} className="text-sm font-medium">
          <span className="mr-1.5 text-xs tabular-nums text-[var(--muted)]">{i + 1}.</span>
          {r.label}
          {r.required && <span className="text-[var(--muted)]"> *</span>}
        </label>
        {r.missing ? (
          <span className="shrink-0 rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">Needs you</span>
        ) : r.fromResume ? (
          <span className="shrink-0 text-[11px] text-[var(--muted)]">from your resume</span>
        ) : null}
      </div>
      {secret ? (
        <p className="mt-2 text-sm text-red-400">
          🔒 This asks for {secret.what}. The agent never fills that in or sends it to an AI, and you shouldn’t type it here.
          {secret.level === "scam" ? " Real employers don’t ask for it on an application — likely a scam." : " If you trust the employer, enter it on their site yourself."}
        </p>
      ) : (
        <div className="mt-2">
          {r.kind === "checkboxes" && opts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {opts.map((o) => (
                <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
                  <input type="checkbox" name={name} value={o} defaultChecked={picked.has(o)} className="accent-[var(--accent)]" />
                  {o}
                </label>
              ))}
            </div>
          ) : opts.length > 0 && opts.length <= 6 ? (
            <div className="flex flex-wrap gap-2">
              {opts.map((o) => (
                <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
                  <input type="radio" name={name} value={o} defaultChecked={current === o} className="accent-[var(--accent)]" />
                  {o}
                </label>
              ))}
            </div>
          ) : opts.length > 6 ? (
            <select id={name} name={name} defaultValue={opts.includes(current) ? current : ""} className={inputCls}>
              <option value="">{current && !opts.includes(current) ? `Current: ${current}` : "Choose…"}</option>
              {opts.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : r.kind === "textarea" || current.length > 90 ? (
            <textarea id={name} name={name} rows={3} defaultValue={current} className={inputCls} placeholder="Your answer" />
          ) : (
            <input id={name} name={name} defaultValue={current} className={inputCls} placeholder="Your answer" />
          )}
        </div>
      )}
    </li>
  );
}
