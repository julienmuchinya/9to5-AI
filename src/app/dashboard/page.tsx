"use client";

import { useLocalStore } from "@/hooks/use-store";
import { APP_NAME } from "@/lib/constants";
import {
  evaluateSetupChecklist,
  isSetupComplete,
  canRunAutopilot,
} from "@/lib/setup-checklist";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Badge, Button, Card, PageHeader, StatCard } from "@/components/ui";

export default function DashboardPage() {
  const { store, update, ready } = useLocalStore();

  if (!ready || !store) {
    return <p className="text-[var(--muted)]">Loading…</p>;
  }

  const checklist = evaluateSetupChecklist({
    supabaseConfigured: isSupabaseConfigured(),
    schemaInstalled: isSupabaseConfigured(),
    geminiOrMock: true,
    gmailConnected: store.autopilot_settings.mock_mode,
    jobEmailSet: Boolean(store.profile.job_email),
    profileComplete: Boolean(store.profile.full_name && store.profile.skills?.length),
    companyCount: store.companies.length,
    activeResumeCount: store.resume_templates.filter((t) => t.is_active).length,
    coverLetterCount: store.cover_letter_templates.length,
    evidenceCount: store.evidence_bank.filter((e) => e.approved).length,
    limitsConfigured: true,
    lastAgentRunOk: store.agent_runs.some(
      (r) => r.status === "completed" &&
        Date.now() - new Date(r.started_at).getTime() < 48 * 3600 * 1000
    ),
    emergencyStopVisible: true,
  });

  const mockMode = store.autopilot_settings.mock_mode;
  const setupDone = isSetupComplete(checklist, { mockMode });
  const autopilotOk = canRunAutopilot(
    checklist,
    store.autopilot_settings.emergency_stop,
    { mockMode }
  );
  const lastRun = store.agent_runs[0];
  const blockedToday = store.blocked_actions.filter((b) => !b.resolved).length;
  const cacheHits = store.ai_cache.length;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`${APP_NAME} agent health and daily usage`}
        action={
          <Button
            variant={store.autopilot_settings.emergency_stop ? "danger" : "secondary"}
            onClick={() =>
              update((s) => ({
                ...s,
                autopilot_settings: {
                  ...s.autopilot_settings,
                  emergency_stop: !s.autopilot_settings.emergency_stop,
                },
              }))
            }
          >
            Emergency stop: {store.autopilot_settings.emergency_stop ? "ON" : "OFF"}
          </Button>
        }
      />

      {!setupDone && (
        <Card className="mb-6 border-amber-800 bg-amber-950/30">
          <p className="font-medium text-amber-200">Setup incomplete</p>
          <p className="mt-1 text-sm text-amber-100/80">
            Full autopilot is disabled until the setup checklist is complete.
          </p>
          <Button href="/setup" variant="secondary" >
            View setup checklist
          </Button>
        </Card>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant={autopilotOk ? "success" : "warning"}>
          Autopilot: {autopilotOk ? "Ready" : "Not ready"}
        </Badge>
        <Badge variant={store.autopilot_settings.auto_apply_enabled ? "success" : "default"}>
          Auto-apply: {store.autopilot_settings.auto_apply_enabled ? "ON" : "OFF"}
        </Badge>
        <Badge variant={store.autopilot_settings.mock_mode ? "warning" : "success"}>
          {store.autopilot_settings.mock_mode ? "Mock mode" : "Live mode"}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Agent health"
          value={lastRun?.status ?? "No runs"}
          sub={lastRun ? `Last run: ${new Date(lastRun.started_at).toLocaleString()}` : undefined}
          variant={lastRun?.status === "completed" ? "success" : "default"}
        />
        <StatCard label="Jobs in pipeline" value={store.jobs.length} sub={`${store.jobs.filter((j) => j.decision === "AUTO_APPLY_READY").length} ready for Part 4`} />
        <StatCard label="Jobs saved today" value={store.agent_usage_limits.jobs_saved_today ?? 0} />
        <StatCard label="Duplicates skipped" value={store.agent_usage_limits.duplicates_skipped_today ?? 0} />
        <StatCard label="Emails scanned" value={store.agent_usage_limits.emails_scanned_today ?? 0} />
        <StatCard label="Companies scanned" value={store.agent_usage_limits.companies_scanned_today ?? 0} />
        <StatCard label="Jobs analyzed today" value={store.agent_usage_limits.jobs_analyzed_today} sub={`Max ${store.agent_usage_limits.maxJobsAnalyzedPerDay}`} />
        <StatCard label="Estimated cost" value="$0.00" variant="success" />
        <StatCard label="Blocked actions" value={blockedToday} variant={blockedToday ? "danger" : "default"} />
        <StatCard label="AI calls today" value={store.agent_usage_limits.ai_calls_today} sub={`Cache hits ${store.agent_usage_limits.cache_hits_today ?? 0}`} />
        <StatCard label="Cache entries" value={cacheHits} sub="Gemini calls saved" />
      </div>
    </div>
  );
}
