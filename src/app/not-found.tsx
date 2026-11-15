import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-[var(--background)] px-6 py-10">
      <div className="w-full max-w-[560px]">
        <p className="kicker !text-[var(--orange-text)]">404 / not found</p>
        <h1 className="display mt-3 text-[44px] sm:text-[56px]">
          This page took <em>another road.</em>
        </h1>
        <p className="mt-3 text-sm text-[var(--muted)]">The link may be old or mistyped. Everything else is where you left it.</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/dashboard" className="inline-flex min-h-[44px] items-center bg-[var(--accent)] px-5 text-sm font-semibold text-white">
            Back to your day ↗
          </Link>
          <Link href="/login" className="inline-flex min-h-[44px] items-center border border-[var(--border-strong)] px-5 text-sm font-semibold">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
