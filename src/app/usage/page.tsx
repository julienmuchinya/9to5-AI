import { requireUser, serviceClient } from "@/lib/v2/session";
import { freeTierSnapshot, SAFETY_RATIO, type LimitCheck } from "@/lib/v2/freeTier";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1)} MB`;

function Meter({ title, check, fmt = (n: number) => n.toLocaleString(), note }: { title: string; check: LimitCheck; fmt?: (n: number) => string; note: string }) {
  const pct = Math.min(100, (check.used / Math.max(1, check.limit)) * 100);
  const color = !check.allowed ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <span className="text-sm text-[var(--muted)]">
          {fmt(check.used)} / {fmt(check.limit)}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--border)]">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        {check.allowed ? note : `Paused: ${check.reason}`}
      </p>
    </Card>
  );
}

export default async function UsagePage() {
  await requireUser();
  const s = await freeTierSnapshot(serviceClient());
  const stop = `${Math.round(SAFETY_RATIO * 100)}%`;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Free-tier usage"
        description={`Every service this app uses has a free plan. The agent checks these before acting and pauses itself at ${stop} so nothing can ever bill you.`}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Meter title="Gemini AI requests (today)" check={s.gemini} note="Resets daily. Used for reading resumes, chat, and application questions." />
        <Meter title="Supabase database" check={s.database} fmt={mb} note="Old job postings are deleted automatically after 30 days." />
        <Meter title="Supabase file storage (resumes)" check={s.storage} fmt={mb} note="One PDF per account." />
        <Meter title="Accounts" check={s.users} note="Supabase free plan: 50,000 monthly active users." />
        {s.githubMinutes.unlimited ? (
          <Card>
            <h3 className="font-medium">GitHub Actions minutes</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">Unlimited — the repository is public. Used this month: {s.githubMinutes.used} min.</p>
          </Card>
        ) : (
          <Meter title="GitHub Actions minutes (this month)" check={s.githubMinutes} note="Private repos get 2,000 free minutes a month." />
        )}
        <Card>
          <h3 className="font-medium">Today</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {s.jobsDiscoveredToday.toLocaleString()} postings scanned · {s.applicationsToday} applications submitted
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Vercel (website) runs on the free Hobby plan, which has hard limits instead of bills.
          </p>
        </Card>
      </div>
    </div>
  );
}
