import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/v2/session";
import { EmptyState, PageHeader } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { ExploreTabs } from "@/components/explore-tabs";
import { SearchEverywhere } from "../jobs/search-everywhere";

export const dynamic = "force-dynamic";
// Live job sites can take a few seconds; results stream in after the page.
export const maxDuration = 30;

const SHOW = [
  ["", "Anywhere"],
  ["remote", "Remote only"],
  ["new", "Last 3 days"],
  ["week", "Last week"],
  ["agent", "Agent can apply"],
] as const;
const PAY: [string, string][] = [
  ["", "Any pay"],
  ["40000", "$40k+"],
  ["60000", "$60k+"],
  ["80000", "$80k+"],
  ["100000", "$100k+"],
];
const IDEAS = ["oil and gas", "nurse", "truck driver", "cashier", "accountant", "data analyst", "electrician", "customer service", "bank teller", "warehouse"];

type SP = { q?: string; show?: string; minpay?: string; loc?: string; pick?: string; msg?: string };

/** Search: every job in any field, from job sites and employers, not only the agent's matches. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const term = (sp.q ?? "").replace(/[,()%*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const show = SHOW.some(([k]) => k === sp.show) ? (sp.show ?? "") : "";
  const minpay = PAY.some(([v]) => v === sp.minpay) ? (sp.minpay ?? "") : "";
  const loc = (sp.loc ?? "").replace(/[^\w\s,.-]/g, "").trim().slice(0, 60);
  const sinceIso = show === "new" ? new Date(Date.now() - 3 * 86400_000).toISOString() : show === "week" ? new Date(Date.now() - 7 * 86400_000).toISOString() : "";

  const qs = (o: Partial<Record<keyof SP, string | undefined>>) => {
    const p = new URLSearchParams();
    const m: Record<string, string | undefined> = { q: term || undefined, show, minpay, loc, ...o };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    const s = p.toString();
    return `/search${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) =>
    `inline-flex min-h-[40px] shrink-0 items-center rounded-full border px-4 text-sm transition ${on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)] bg-[var(--card)] hover:border-[var(--foreground)]"}`;

  return (
    <div>
      <PageHeader
        eyebrow="Explore / every job, every field"
        aside="Job sites + employers, live"
        title="Explore *any* job."
        description="Search like a job site: any title, company, skill or industry. Read what each job asks for, then apply with the agent — one at a time or several at once."
      />

      <ExploreTabs active="search" term={term} />

      {sp.msg && (
        <p role="alert" className="mb-6 border-l-[3px] border-red-400 bg-red-900/60 px-4 py-3 text-sm text-red-200">
          {sp.msg}
        </p>
      )}

      <SearchBox action="/search" defaultValue={term} clearHref="/search" autoFocus={!term} placeholder="Job title, company, skill or industry — e.g. oil" label="Search every job">
        {show && <input type="hidden" name="show" value={show} />}
        {minpay && <input type="hidden" name="minpay" value={minpay} />}
        {loc && <input type="hidden" name="loc" value={loc} />}
      </SearchBox>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {SHOW.map(([k, l]) => (
          <Link key={k} href={qs({ show: k || undefined, pick: undefined })} aria-current={show === k ? "true" : undefined} className={chip(show === k)}>
            {l}
          </Link>
        ))}
        <form action="/search" className="ml-auto flex flex-wrap items-center gap-2">
          {term && <input type="hidden" name="q" value={term} />}
          {show && <input type="hidden" name="show" value={show} />}
          <label className="sr-only" htmlFor="minpay">
            Minimum pay
          </label>
          <select id="minpay" name="minpay" defaultValue={minpay} className="min-h-[40px] rounded-sm border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm">
            {PAY.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="loc">
            Location contains
          </label>
          <input id="loc" name="loc" defaultValue={loc} placeholder="City or state" className="min-h-[40px] w-36 rounded-sm border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm" />
          <button className="min-h-[40px] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-sm font-semibold hover:border-[var(--foreground)]">Filter</button>
          {(minpay || loc) && (
            <Link href={qs({ minpay: undefined, loc: undefined, pick: undefined })} className="min-h-[40px] px-2 py-2 text-sm underline underline-offset-4">
              Clear filters
            </Link>
          )}
        </form>
      </div>

      {term ? (
        <Suspense
          key={`${term}|${show}|${minpay}|${loc}`}
          fallback={
            <div className="mt-8 space-y-2" aria-busy="true">
              <p className="text-sm text-[var(--muted)]">Searching job sites and 60+ employers for “{term}”…</p>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 animate-pulse bg-[var(--hover)]" />
              ))}
            </div>
          }
        >
          <SearchEverywhere term={term} pick={sp.pick ?? ""} base={qs({ pick: undefined })} sinceIso={sinceIso} remoteOnly={show === "remote"} minpay={Number(minpay) || 0} loc={loc} agentOnly={show === "agent"} />
        </Suspense>
      ) : (
        <div className="mt-10">
          <EmptyState
            title="What are you looking for?"
            message="Type any job — not only the roles you set up for the agent. Results come from job sites and employers’ career pages, in every field. Tick the ones you like and press Apply with agent."
          />
          <p className="kicker mt-8">Try</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {IDEAS.map((i) => (
              <Link key={i} href={qs({ q: i, pick: undefined })} className={chip(false)}>
                {i}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
