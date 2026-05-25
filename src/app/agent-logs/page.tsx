"use client";

import { useState } from "react";
import { useLocalStore } from "@/hooks/use-store";
import { APP_NAME } from "@/lib/constants";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

export default function AgentLogsPage() {
  const { store, update, ready } = useLocalStore();
  const [running, setRunning] = useState(false);

  if (!ready || !store) return <p>Loading…</p>;

  const runAgent = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/agent/run", { method: "POST" });
      const data = await res.json();
      if (data.store) {
        update(() => data.store);
      }
    } finally {
      setRunning(false);
    }
  };

  const logsForRun = (runId: string) =>
    store.agent_logs.filter((l) => l.run_id === runId);

  return (
    <div>
      <PageHeader
        title="Agent Logs"
        description={`${APP_NAME} cloud agent run history`}
        action={
          <Button onClick={runAgent} disabled={running}>
            {running ? "Running…" : "Run agent now (mock)"}
          </Button>
        }
      />
      {store.agent_runs.length === 0 ? (
        <EmptyState message="No agent runs yet. Trigger a mock run or wait for GitHub Actions." action={<Button onClick={runAgent}>Run now</Button>} />
      ) : (
        <ul className="space-y-4">
          {store.agent_runs.map((run) => (
            <li key={run.id}>
              <Card>
                <div className="flex items-center gap-2">
                  <Badge variant={run.status === "completed" ? "success" : "warning"}>{run.status}</Badge>
                  <span className="text-sm text-[var(--muted)]">
                    {new Date(run.started_at).toLocaleString()}
                    {run.mock_mode && " · mock"}
                  </span>
                </div>
                <pre className="mt-2 max-h-24 overflow-auto text-xs text-[var(--muted)]">
                  {JSON.stringify(run.summary, null, 2)}
                </pre>
                <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-3">
                  {logsForRun(run.id).map((log) => (
                    <li key={log.id} className="text-xs">
                      <span className="text-[var(--muted)]">[{log.level}]</span> {log.message}
                      {log.metadata?.step != null && (
                        <span className="ml-1 text-[var(--muted)]">
                          · {String(log.metadata.step)}
                          {log.metadata.durationMs != null &&
                            ` · ${log.metadata.durationMs}ms`}
                          {log.metadata.source != null &&
                            ` · ${String(log.metadata.source)}`}
                          {log.metadata.cache === true && " · cache hit"}
                        </span>
                      )}
                      {log.metadata?.reasonCode != null && (
                        <span className="block text-[var(--muted)]">
                          {String(log.metadata.reasonCode)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
