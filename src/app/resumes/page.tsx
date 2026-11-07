import Link from "next/link";
import { requireUser } from "@/lib/v2/session";
import { Badge, Card, EmptyState, Notice, PageHeader, buttonCls } from "@/components/ui";
import { loadLibrary } from "@/lib/v2/resume-library";
import { statusRows, statsByResume } from "@/lib/v2/pipeline";
import { fallbackConfigured } from "@/lib/v2/fallback-ai";
import { RenameDelete, UploadResume } from "./resume-manager";

export const dynamic = "force-dynamic";

const pct = (x: number) => `${Math.round(100 * x)}%`;

export default async function ResumesPage() {
  const { supabase, user } = await requireUser();
  const { data: p } = await supabase.from("profiles").select("resume_path,resume_parsed,resume_updated_at").eq("id", user.id).maybeSingle();
  const [lib, rows] = await Promise.all([loadLibrary(supabase, user.id, p ?? {}), statusRows(supabase, user.id)]);
  const mainLabel = lib.resumes.find((r) => r.id === "main")?.label ?? "Main resume";
  const stats = statsByResume(
    rows,
    lib.resumes.map((r) => r.label),
    mainLabel
  );
  const best = [...stats.entries()].filter(([, s]) => s.sent >= 5).sort((a, b) => b[1].rate - a[1].rate)[0];
  const aiTailor = fallbackConfigured();

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Resumes"
        title="Your resumes"
        description="Keep one resume per kind of role. For every job the agent picks the resume that fits best, keeps your layout on one page, and puts the job’s keywords in bold."
      />

      <Notice tone="info">
        {aiTailor
          ? "Tailoring is on: the backup AI rewords your real bullets toward each job description (same facts and numbers, nothing invented), then the agent checks it in code before sending."
          : "Free tailoring is on: the agent reorders your bullets and skills for each job and bolds the keywords it asks for. Add a free GROQ_API_KEY to also reword bullets per job — it never uses your Gemini quota."}
      </Notice>

      {best && lib.resumes.length > 1 && (
        <p className="mt-4 text-sm">
          🏆 <span className="font-medium">{best[0]}</span> is working best: {pct(best[1].rate)} of its {best[1].sent} applications moved forward.
        </p>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {lib.resumes.length === 0 && (
          <div className="md:col-span-2">
            <EmptyState message="No resume yet. Upload your main resume to start." />
          </div>
        )}
        {lib.resumes.map((r) => {
          const s = stats.get(r.label);
          const parsed = r.parsed;
          const groups = parsed?.skill_groups?.length ?? 0;
          return (
            <Card key={r.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-semibold">{r.label}</h2>
                    {r.id === "main" && <Badge variant="accent">Main · fills your profile</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {parsed ? `${parsed.experience?.length ?? 0} jobs · ${parsed.projects?.length ?? 0} projects · ${parsed.skills?.length ?? 0} skills` : "Not read yet"}
                    {r.uploaded_at ? ` · uploaded ${new Date(r.uploaded_at).toLocaleDateString()}` : ""}
                  </p>
                  {parsed?.target_roles?.length ? <p className="mt-1 truncate text-xs text-[var(--muted)]">Best for: {parsed.target_roles.slice(0, 3).join(", ")}</p> : null}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  ["Sent", s?.sent ?? 0],
                  ["Moved on", s?.progressed ?? 0],
                  ["Interviews", s?.interviews ?? 0],
                  ["Rejected", s?.rejected ?? 0],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-lg bg-[var(--background-2)] px-1 py-2">
                    <p className="text-lg font-semibold tabular-nums">{v}</p>
                    <p className="text-[11px] text-[var(--muted)]">{k}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex justify-between text-xs text-[var(--muted)]">
                  <span>Response rate</span>
                  <span>{s?.sent ? pct(s.rate) : "—"}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-white/5">
                  <div className="h-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]" style={{ width: s?.sent ? pct(s.rate) : "0%" }} />
                </div>
              </div>

              {parsed && !groups && !parsed.headline && (
                <p className="text-xs text-amber-300">Click “Read it again” so the agent picks up your skill groups, tagline and bold phrases — then its copy matches your design exactly.</p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                <a href={`/api/resume?id=${r.id}`} target="_blank" rel="noopener noreferrer" className={buttonCls("secondary", "sm")}>
                  Original ↗
                </a>
                {parsed && (
                  <a href={`/api/resume?id=${r.id}&preview=1`} target="_blank" rel="noopener noreferrer" className={buttonCls("secondary", "sm")}>
                    Agent’s version ↗
                  </a>
                )}
                <RenameDelete id={r.id} label={r.label} canDelete={r.id !== "main"} />
              </div>
              <UploadResume id={r.id} cta="Replace PDF" />
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <h2 className="mb-1 font-semibold">Add another resume</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          e.g. one focused on AI/ML, one on embedded or full-stack. Your profile and contact details stay the same — only the resume changes. {lib.resumes.length === 0 && "Upload your main resume first on "}
          {lib.resumes.length === 0 && (
            <Link href="/profile" className="text-[var(--accent)] hover:underline">
              Resume & profile
            </Link>
          )}
        </p>
        <UploadResume id={lib.resumes.length === 0 ? "main" : "new"} cta={lib.resumes.length === 0 ? "Upload main resume (PDF)" : "Upload PDF"} canReread={false} />
      </Card>
    </div>
  );
}
