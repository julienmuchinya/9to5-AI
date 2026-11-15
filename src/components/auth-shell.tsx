import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Full-screen public context (welcome, sign in, sign up, recovery): a pine panel with the brand
 * statement on the left, the form on warm paper on the right. On phones the panel becomes a short band.
 */
export function AuthShell({ statement = "A little more *clarity.*", note, children }: { statement?: string; note?: string; children: ReactNode }) {
  const parts = statement.split(/\*([^*]+)\*/);
  return (
    <div className="grid min-h-screen bg-[var(--paper)] lg:grid-cols-2">
      <aside className="relative flex flex-col overflow-hidden bg-[#173d32] px-6 py-6 text-[#eef0e6] sm:px-12 lg:min-h-screen lg:px-[72px] lg:py-12">
        <span className="pointer-events-none absolute -right-48 top-1/2 hidden h-[860px] w-[860px] -translate-y-1/2 rounded-full border-[70px] border-white/[0.04] lg:block" aria-hidden />
        <span className="pointer-events-none absolute -right-24 top-1/2 hidden h-[650px] w-[650px] -translate-y-1/2 rounded-full border border-white/[0.07] lg:block" aria-hidden />
        <Link href="/" className="relative font-serif text-[34px] leading-none tracking-[-0.06em] lg:text-[40px]" aria-label="9to5 home">
          9to5<span className="text-[#e76a45]">.</span>
        </Link>
        <div className="relative mt-8 lg:mt-auto">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#f0b796]">Your career desk</p>
          <p className="display mt-4 text-[40px] text-[#f7f5ef] sm:text-[52px] lg:text-[76px]">
            {parts.map((p, i) =>
              i % 2 ? (
                <span key={i}>
                  {p.replace(/\.$/, "")}
                  <span className="text-[#e76a45]">.</span>
                </span>
              ) : (
                <span key={i}>{p}</span>
              )
            )}
          </p>
          <p className="mt-6 hidden max-w-md text-[15px] leading-relaxed text-[#cfd9d2] sm:block">
            {note ?? "Good opportunities deserve thoughtful attention. Your search starts with a place to keep everything together."}
          </p>
        </div>
        <p className="relative mt-10 hidden font-mono text-[11px] uppercase tracking-[0.14em] text-[#9fb3a8] lg:block">Work, without the noise</p>
      </aside>
      <main className="flex items-start justify-center px-6 py-10 sm:px-12 lg:items-center lg:px-[72px]">
        <div className="w-full max-w-[490px]">{children}</div>
      </main>
    </div>
  );
}

/** Mono kicker + serif heading + supporting line, for the right-hand form. */
export function AuthHeading({ over, title, sub }: { over: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--orange-text)]">{over}</p>
      <h1 className="display mt-4 text-[40px] sm:text-[52px]">{title}</h1>
      {sub && <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

/** Field style for the auth forms. */
export const authInput =
  "mt-2 h-[50px] w-full rounded-sm border border-[var(--border-strong)] bg-[var(--sheet)] px-3.5 font-sans text-[15px] normal-case tracking-normal text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)]/80 focus:border-[var(--green)] focus:ring-2 focus:ring-[var(--green)]/15";
export const authLabel = "block font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--foreground)]";
export const authButton =
  "flex h-[44px] w-full items-center justify-center gap-2 rounded-sm bg-[var(--green)] px-4 text-sm font-semibold text-white transition hover:bg-[#0f2d24] disabled:opacity-50";
