export default function Loading() {
  return (
    <div className="max-w-5xl animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-2 h-7 w-48 rounded bg-[var(--border)]" />
      <div className="mb-8 h-4 w-80 max-w-full rounded bg-[var(--border)]" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-[var(--card)]" />
        ))}
      </div>
      <div className="mt-6 h-48 rounded-xl bg-[var(--card)]" />
    </div>
  );
}
