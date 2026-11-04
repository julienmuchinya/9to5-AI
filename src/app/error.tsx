"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Shown when a page or a form save fails, instead of a blank crash screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const m = error.message ?? "";
  const hint = /fetch|network|failed to fetch/i.test(m)
    ? "Your connection dropped. Check your internet and try again."
    : /jwt|session|not signed in|auth/i.test(m)
      ? "Your session expired. Sign in again."
      : /quota|budget|limit/i.test(m)
        ? "A free-tier limit was reached. It resets automatically — see Free-tier usage."
        : m && !/digest|server components/i.test(m)
          ? m
          : "Something went wrong on our side. Your data is safe.";
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 text-center">
        <h1 className="text-lg font-semibold">That didn’t work</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{hint}</p>
        {error.digest && <p className="mt-2 text-xs text-[var(--muted)]">Error ID: {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={reset} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
            Try again
          </button>
          <Link href="/dashboard" className="rounded-lg bg-[var(--border)] px-4 py-2 text-sm">
            Dashboard
          </Link>
          {/session|sign in/i.test(hint) && (
            <Link href="/login" className="rounded-lg bg-[var(--border)] px-4 py-2 text-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
