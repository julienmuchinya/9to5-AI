import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="max-w-sm text-center">
        <p className="text-5xl font-bold text-[var(--accent)]">404</p>
        <h1 className="mt-3 text-lg font-semibold">This page doesn’t exist</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">The link may be old or mistyped.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/dashboard" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
            Go to dashboard
          </Link>
          <Link href="/login" className="rounded-lg bg-[var(--border)] px-4 py-2 text-sm">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
