import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/v2/session";
import { AuthShell, AuthHeading, authButton } from "@/components/auth-shell";

/** Public welcome. Signed-in people go straight to their desk. */
export default async function Home() {
  const { user } = await currentUser();
  if (user) redirect("/dashboard");

  const points: [string, string][] = [
    ["A shortlist with your name on it.", "Roles in any field that fit the work you want — matched to your resume, checked for real employers."],
    ["Prepared isn’t submitted.", "Drafts stay yours. The agent only applies within the rules you set, and you can pause it any time."],
    ["Keep the thread.", "Every application keeps its own history, next step and confirmation — nothing is marked sent without evidence."],
  ];
  return (
    <AuthShell statement="Find work *worth doing.*" note="Your roles, your pace, your rules. Fewer tabs, better decisions — and an agent that does the repetitive parts.">
      <AuthHeading over="Welcome / 9to5" title={<>Make space for<br />what’s next.</>} sub="A calm career desk: find roles worth your time, prepare strong applications, and follow every reply in one place." />
      <div className="space-y-3">
        <Link href="/signup" className={authButton}>
          Create your workspace ↗
        </Link>
        <Link href="/login" className="flex h-[44px] w-full items-center justify-center rounded-sm border border-[var(--border-strong)] bg-[var(--sheet)] px-4 text-sm font-semibold hover:border-[var(--foreground)]">
          I already have an account
        </Link>
      </div>
      <ol className="mt-10 border-t border-[var(--foreground)]">
        {points.map(([h, b], i) => (
          <li key={h} className="grid grid-cols-[2.5rem_1fr] gap-2 border-b border-[var(--border)] py-4">
            <span className="font-mono text-xs text-[var(--muted)]">{String(i + 1).padStart(2, "0")}</span>
            <span>
              <span className="block font-semibold">{h}</span>
              <span className="mt-0.5 block text-sm text-[var(--muted)]">{b}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-xs text-[var(--muted)]">Private by default. Your resume and profile are used only to find and fill in your applications.</p>
    </AuthShell>
  );
}
