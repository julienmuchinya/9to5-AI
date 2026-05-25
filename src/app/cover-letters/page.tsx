"use client";

import { useLocalStore } from "@/hooks/use-store";
import { Card, PageHeader } from "@/components/ui";

export default function CoverLettersPage() {
  const { store, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  return (
    <div>
      <PageHeader
        title="Cover Letter Library"
        description="Templates reused at 90%+ match before generating new letters"
      />
      <ul className="space-y-3">
        {store.cover_letter_templates.map((t) => (
          <li key={t.id}>
            <Card>
              <p className="font-medium">{t.name}</p>
              <pre className="mt-3 max-h-28 overflow-auto rounded bg-[var(--background)] p-3 text-xs whitespace-pre-wrap">
                {t.content.slice(0, 350)}…
              </pre>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
