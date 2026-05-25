"use client";

import { useLocalStore } from "@/hooks/use-store";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

export default function ResumesPage() {
  const { store, update, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  const active = store.resume_templates.filter((t) => t.is_active).length;

  return (
    <div>
      <PageHeader
        title="Resume Library"
        description={`${active} active templates — agent picks best match before generating`}
      />
      <ul className="space-y-3">
        {store.resume_templates.map((t) => (
          <li key={t.id}>
            <Card>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-sm text-[var(--muted)]">{t.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={t.is_active ? "success" : "default"}>
                    {t.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      update((s) => ({
                        ...s,
                        resume_templates: s.resume_templates.map((r) =>
                          r.id === t.id ? { ...r, is_active: !r.is_active } : r
                        ),
                      }))
                    }
                  >
                    Toggle
                  </Button>
                </div>
              </div>
              <pre className="mt-3 max-h-32 overflow-auto rounded bg-[var(--background)] p-3 text-xs whitespace-pre-wrap">
                {t.content.slice(0, 400)}…
              </pre>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
