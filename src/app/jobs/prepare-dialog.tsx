"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/drawer";
import { prepareApplication } from "../actions";

/**
 * "Make it yours. Then decide." — the focused review before anything happens to an application.
 * A draft is only a record for you. Queuing hands it to the agent. Either needs an explicit tick.
 */
export function PrepareDialog({
  jobId,
  title,
  company,
  place,
  canSubmit,
  verified,
  ats,
  resumes,
  showTrigger = true,
}: {
  /** False once the role has an application; the dialog stays mounted so an open confirmation survives the refresh. */
  showTrigger?: boolean;
  jobId: string;
  title: string;
  company: string;
  place: string;
  canSubmit: boolean;
  verified: boolean;
  ats: string;
  resumes: number;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"draft" | "queue">(verified ? "queue" : "draft");
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string; appId?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  // Stable (useCallback): the dialog re-runs its focus handling whenever onClose changes.
  // After a save, refresh once more on close so the role shows its new status.
  const saved = Boolean(msg?.ok);
  const close = useCallback(() => {
    setOpen(false);
    if (saved) router.refresh();
  }, [saved, router]);

  const ackText =
    mode === "draft"
      ? "I understand a draft is only saved here. Nothing is sent to the employer."
      : canSubmit
        ? `I’ve reviewed this role and want the agent to fill in and submit the ${ats} application for me on its next run.`
        : "I want the agent to prepare my answers. I’ll submit this one myself — it can’t submit on this site.";

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setMsg(null);
            setAck(false);
          }}
          className="inline-flex min-h-[44px] items-center gap-2 bg-[var(--accent)] px-5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
        >
          Prepare application ↗
        </button>
      )}
      <Drawer open={open} onClose={close} label={`Prepare application: ${title}`} modal>
        <div className="p-6 sm:p-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="kicker !text-[var(--orange-text)]">Before you apply / review</p>
              <h2 className="display mt-3 text-[36px] sm:text-[44px]">
                Make it yours.
                <br />
                Then decide.
              </h2>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-sm border border-[var(--border-strong)] text-lg hover:border-[var(--foreground)]">
              ×
            </button>
          </div>
          <p className="mt-4 text-sm text-[var(--muted)]">A prepared draft is not a submitted application. Choose what happens next — nothing is sent until you say so.</p>

          <div className="mt-6 flex items-center gap-4 border-y border-[var(--border)] py-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-sm border border-[var(--border-strong)] bg-[var(--card)] font-serif text-[22px]" aria-hidden>
              {company.trim()[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{title}</p>
              <p className="truncate text-xs text-[var(--muted)]">
                {company} · {place}
              </p>
            </div>
            <span className="bg-[var(--hover)] px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-[var(--muted)]">Not submitted</span>
          </div>

          {msg?.ok ? (
            <div className="mt-6" role="status">
              <p className="border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3 text-sm">{msg.message}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {msg.appId && (
                  <Link href={`/applications?tab=all&app=${msg.appId}`} className="inline-flex min-h-[44px] items-center bg-[var(--accent)] px-5 text-sm font-semibold text-white">
                    Open in Applications ↗
                  </Link>
                )}
                <button type="button" onClick={close} className="min-h-[44px] border border-[var(--border-strong)] px-5 text-sm font-semibold">
                  Back to roles
                </button>
              </div>
            </div>
          ) : (
            <form
              className="mt-6 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => setMsg(await prepareApplication(jobId, { mode, note, acknowledged: ack })));
              }}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="kicker">Resume</p>
                  <p className="mt-2 text-sm">
                    {resumes > 1 ? `The agent picks the best of your ${resumes} resumes for this role.` : resumes === 1 ? "Your resume on file." : "No resume yet — add one in your profile first."}
                  </p>
                </div>
                <label className="block">
                  <span className="kicker">What happens next</span>
                  <select
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value as "draft" | "queue");
                      setAck(false);
                    }}
                    className="mt-2 min-h-[44px] w-full rounded-sm border border-[var(--border-strong)] bg-[var(--card)] px-3 text-sm"
                  >
                    <option value="draft">Save draft only — nothing is sent</option>
                    {verified && <option value="queue">{canSubmit ? "Queue for the agent to submit" : "Queue for the agent to prepare"}</option>}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="kicker">Your note (optional)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why are you interested? Anything to remember about this one?"
                  className="mt-2 min-h-[96px] w-full rounded-sm border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                />
                <span className="mt-1 block text-xs text-[var(--muted)]">Kept on the application’s timeline. It isn’t sent to the employer.</span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" required />
                <span>{ackText}</span>
              </label>
              {msg && !msg.ok && (
                <p role="alert" className="text-sm text-red-400">
                  {msg.message}
                  {msg.appId && (
                    <>
                      {" "}
                      <Link href={`/applications?tab=all&app=${msg.appId}`} className="underline">
                        Open it
                      </Link>
                    </>
                  )}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] border border-[var(--border-strong)] bg-[var(--card)] px-5 text-sm font-semibold">
                  Back to role
                </button>
                <button disabled={!ack || pending} className="min-h-[44px] bg-[var(--accent)] px-5 text-sm font-semibold text-white disabled:opacity-40">
                  {pending ? "Saving…" : mode === "draft" ? "Save draft ↗" : "Queue for the agent ↗"}
                </button>
              </div>
            </form>
          )}
        </div>
      </Drawer>
    </>
  );
}
