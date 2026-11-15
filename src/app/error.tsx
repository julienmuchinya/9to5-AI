"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Shown when a page or a form save fails: a calm explanation and a non-destructive retry. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const m = error.message ?? "";
  const session = /jwt|session|not signed in|auth/i.test(m);
  const hint = /fetch|network|failed to fetch/i.test(m)
    ? "Your connection dropped. Check your internet and try again."
    : session
      ? "Your session expired. Sign in again to pick up where you left off."
      : /quota|budget|limit/i.test(m)
        ? "A free-tier limit was reached. It resets automatically — see AI usage."
        : m && !/digest|server components/i.test(m)
          ? m
          : "Something went wrong on our side. Nothing was lost, and nothing was sent to an employer.";
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-10" role="alert">
      <div className="w-full max-w-[560px] border border-[var(--border)] bg-[var(--card)] p-8 sm:p-10">
        <p className="kicker !text-[var(--orange-text)]">Error / {session ? "session" : "request"}</p>
        <h1 className="display mt-3 text-[34px] sm:text-[40px]">Something interrupted the flow.</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{hint}</p>
        {error.digest && <p className="mt-3 font-mono text-[11px] text-[var(--muted)]">Reference: {error.digest}</p>}
        <div className="mt-7 flex flex-wrap gap-3">
          {session ? (
            <Link href="/login" className="inline-flex min-h-[44px] items-center bg-[var(--accent)] px-5 text-sm font-semibold text-white">
              Sign in ↗
            </Link>
          ) : (
            <button onClick={reset} className="min-h-[44px] bg-[var(--accent)] px-5 text-sm font-semibold text-white">
              Try again ↗
            </button>
          )}
          <Link href="/dashboard" className="inline-flex min-h-[44px] items-center border border-[var(--border-strong)] px-5 text-sm font-semibold">
            Back to your day
          </Link>
        </div>
      </div>
    </div>
  );
}
