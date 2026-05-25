"use client";

import { useLocalStore } from "@/hooks/use-store";
import { evaluateSetupChecklist, isSetupComplete } from "@/lib/setup-checklist";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { APP_NAME } from "@/lib/constants";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

export default function SetupPage() {
  const { store, ready } = useLocalStore();

  if (!ready || !store) return <p className="text-[var(--muted)]">Loading…</p>;

  const items = evaluateSetupChecklist({
    supabaseConfigured: isSupabaseConfigured(),
    schemaInstalled: isSupabaseConfigured(),
    geminiOrMock: true,
    gmailConnected: false,
    jobEmailSet: Boolean(store.profile.job_email),
    profileComplete: Boolean(store.profile.full_name),
    companyCount: store.companies.length,
    activeResumeCount: store.resume_templates.filter((t) => t.is_active).length,
    coverLetterCount: store.cover_letter_templates.length,
    evidenceCount: store.evidence_bank.filter((e) => e.approved).length,
    limitsConfigured: true,
    lastAgentRunOk: store.agent_runs.some((r) => r.status === "completed"),
    emergencyStopVisible: true,
  });

  const mockMode = store.autopilot_settings.mock_mode;
  const complete = isSetupComplete(items, { mockMode });
  const doneCount = items.filter((i) => i.complete).length;

  return (
    <div>
      <PageHeader
        title="Setup checklist"
        description={`Complete these steps before ${APP_NAME} runs full autopilot`}
        action={
          <Badge variant={complete ? "success" : "warning"}>
            {doneCount}/{items.length} complete
          </Badge>
        }
      />

      {!complete && (
        <Card className="mb-6 border-amber-800">
          <p className="text-sm">
            Missing items block full autopilot. Mock mode remains available for testing.
          </p>
        </Card>
      )}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <Card className={item.complete ? "border-emerald-900" : ""}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={item.complete ? "text-emerald-400" : "text-[var(--muted)]"}>
                      {item.complete ? "✓" : "○"}
                    </span>
                    <span className="font-medium">{item.label}</span>
                  </div>
                  {!item.complete && (
                    <p className="mt-2 text-sm text-[var(--muted)]">{item.fixSteps}</p>
                  )}
                </div>
                {item.href && !item.complete && (
                  <Button href={item.href} variant="secondary">
                    Fix
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
