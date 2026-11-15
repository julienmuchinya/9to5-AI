/** Skeleton in the Career Desk rhythm: overline, serif headline, ruled rows. */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-5 h-3 w-48 bg-[var(--border)]" />
      <div className="mb-3 h-14 w-[min(560px,90%)] bg-[var(--border)]" />
      <div className="mb-10 h-4 w-80 max-w-full bg-[var(--border)]" />
      <div className="border-t-2 border-[var(--border-strong)]">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-[var(--border)] py-5">
            <div className="h-11 w-11 shrink-0 bg-[var(--border)]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 bg-[var(--border)]" />
              <div className="h-4 w-2/3 bg-[var(--border)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
