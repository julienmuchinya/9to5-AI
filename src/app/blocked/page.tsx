"use client";

import { useLocalStore } from "@/hooks/use-store";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

export default function BlockedPage() {
  const { store, update, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  const open = store.blocked_actions.filter((b) => !b.resolved);

  return (
    <div>
      <PageHeader title="Blocked Actions" description="Items requiring your attention" />
      {open.length === 0 ? (
        <EmptyState message="No blocked actions" />
      ) : (
        <ul className="space-y-3">
          {open.map((b) => (
            <li key={b.id}>
              <Card>
                <Badge variant="danger">{b.reason_code}</Badge>
                <p className="mt-2">{b.reason_detail}</p>
                {b.suggested_action && (
                  <p className="mt-1 text-sm text-[var(--muted)]">{b.suggested_action}</p>
                )}
                <Button
                  className="mt-3"
                  variant="secondary"
                  onClick={() =>
                    update((s) => ({
                      ...s,
                      blocked_actions: s.blocked_actions.map((x) =>
                        x.id === b.id ? { ...x, resolved: true } : x
                      ),
                    }))
                  }
                >
                  Mark resolved
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
