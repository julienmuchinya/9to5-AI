"use client";

import { useLocalStore } from "@/hooks/use-store";
import { APP_NAME, PASSWORD_STORAGE_ENABLED } from "@/lib/constants";
import { Button, Card, PageHeader } from "@/components/ui";
import { resetStore } from "@/lib/store/local-store";
import { exportMockData, importMockData } from "@/lib/storage/mockStorageAdapter";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { detectRuntimeMode } from "@/lib/config/runtimeMode";

export default function SettingsPage() {
  const { store, update, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  const s = store.autopilot_settings;
  const runtimeMode = detectRuntimeMode();
  const supabaseReady = isSupabaseConfigured();

  return (
    <div>
      <PageHeader title="Settings" description={`${APP_NAME} configuration`} />
      <Card className="mb-4 space-y-2">
        <p className="text-sm text-[var(--muted)]">
          Runtime: <strong>{runtimeMode}</strong> · Supabase:{" "}
          {supabaseReady ? "configured" : "not configured"}
        </p>
      </Card>
      <Card className="space-y-4">
        <Toggle
          label="Mock mode (local)"
          checked={s.mock_mode}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: { ...st.autopilot_settings, mock_mode: v },
            }))
          }
          hint="Mirrors NEXT_PUBLIC_MOCK_MODE — use env for production builds"
        />
        <Toggle
          label="Email scanning enabled"
          checked={s.email_scanning_enabled}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: { ...st.autopilot_settings, email_scanning_enabled: v },
            }))
          }
          hint="Scan job-alert emails only (never full inbox)"
        />
        <Toggle
          label="Company career page scanning"
          checked={s.company_scanning_enabled}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: { ...st.autopilot_settings, company_scanning_enabled: v },
            }))
          }
        />
        <Toggle
          label="Scan unread job alerts only"
          checked={s.scan_unread_only}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: { ...st.autopilot_settings, scan_unread_only: v },
            }))
          }
        />
        <Toggle
          label="Mark processed emails as read"
          checked={s.mark_processed_emails}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: { ...st.autopilot_settings, mark_processed_emails: v },
            }))
          }
          hint="Default OFF — does not mark emails read unless you enable"
        />
        <Toggle
          label="Use Gemini (live only)"
          checked={s.use_gemini}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: {
                ...st.autopilot_settings,
                use_gemini: v,
                gemini_enabled: v,
              },
            }))
          }
          hint="Default OFF until setup complete"
        />
        <Toggle
          label="Dry run (no side effects)"
          checked={s.dry_run}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: { ...st.autopilot_settings, dry_run: v },
            }))
          }
          hint="Default ON — safe for Part 3 intake"
        />
        <Toggle
          label="Auto-apply (autopilot)"
          checked={s.auto_apply_enabled}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: { ...st.autopilot_settings, auto_apply_enabled: v },
            }))
          }
          hint="OFF by default. Part 3 does not submit applications."
        />
        <Toggle
          label="Emergency stop"
          checked={s.emergency_stop}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: { ...st.autopilot_settings, emergency_stop: v },
            }))
          }
          hint="When ON, agent will not run live actions"
        />
        <Toggle
          label="Encrypted password storage"
          checked={s.password_storage_enabled}
          disabled={!PASSWORD_STORAGE_ENABLED}
          onChange={(v) =>
            update((st) => ({
              ...st,
              autopilot_settings: {
                ...st.autopilot_settings,
                password_storage_enabled: v,
              },
            }))
          }
          hint="Disabled by default — use password manager reference only"
        />
        <div className="border-t border-[var(--border)] pt-4">
          <p className="mb-2 text-sm font-medium">Mock data tools</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const json = exportMockData(store);
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `9to5-ai-mock-export-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export mock data
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const raw = prompt("Paste exported JSON");
                if (!raw) return;
                try {
                  const imported = importMockData(raw);
                  update(() => imported);
                  alert("Mock data imported");
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Import failed");
                }
              }}
            >
              Import mock data
            </Button>
            {supabaseReady && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const res = await fetch("/api/setup/status");
                  const data = await res.json();
                  alert(
                    data.setupComplete
                      ? "Setup complete — use agent API with AGENT_SECRET to push runs to Supabase"
                      : "Setup incomplete — finish checklist first"
                  );
                }}
              >
                Check Supabase readiness
              </Button>
            )}
          </div>
        </div>
        <div className="border-t border-[var(--border)] pt-4">
          <p className="mb-2 text-sm font-medium">Environment (server)</p>
          <ul className="text-xs text-[var(--muted)] space-y-1">
            <li>NEXT_PUBLIC_MOCK_MODE — mock vs live</li>
            <li>NEXT_PUBLIC_SUPABASE_URL / ANON_KEY — database</li>
            <li>AGENT_SECRET — agent API (server only)</li>
            <li>GEMINI_API_KEY — server only</li>
            <li>GOOGLE_CLIENT_SECRET — server only</li>
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">
            See docs/SUPABASE_SETUP.md, DEPLOYMENT.md, GITHUB_ACTIONS_SETUP.md
          </p>
        </div>
        <Button
          variant="danger"
          onClick={() => {
            resetStore();
            window.location.reload();
          }}
        >
          Reset local mock data
        </Button>
      </Card>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1"
      />
      <div>
        <span className="font-medium">{label}</span>
        {hint && <p className="text-sm text-[var(--muted)]">{hint}</p>}
      </div>
    </label>
  );
}
