"use client";

import { useState } from "react";
import { useLocalStore } from "@/hooks/use-store";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";

export default function CompaniesPage() {
  const { store, update, ready } = useLocalStore();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [careerUrl, setCareerUrl] = useState("");

  if (!ready || !store) return <p>Loading…</p>;

  const add = () => {
    if (!name.trim()) return;
    update((s) => ({
      ...s,
      companies: [
        ...s.companies,
        {
          id: crypto.randomUUID(),
          name: name.trim(),
          domain: domain.trim() || undefined,
          career_url: careerUrl.trim() || undefined,
          trust_score: 85,
          scan_enabled: true,
        },
      ],
    }));
    setName("");
    setDomain("");
    setCareerUrl("");
  };

  return (
    <div>
      <PageHeader title="Companies" description="Watchlist for career page scanning" />
      <Card className="mb-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <input placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
          <input placeholder="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
          <input placeholder="Career page URL" value={careerUrl} onChange={(e) => setCareerUrl(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
        </div>
        <Button onClick={add} variant="primary">Add company</Button>
      </Card>
      {store.companies.length === 0 ? (
        <EmptyState message="No companies yet" />
      ) : (
        <ul className="space-y-2">
          {store.companies.map((c) => (
            <li key={c.id}>
              <Card className="flex justify-between">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-[var(--muted)]">{c.domain} · Trust {c.trust_score}</p>
                </div>
                <Button
                  variant="danger"
                  onClick={() =>
                    update((s) => ({
                      ...s,
                      companies: s.companies.filter((x) => x.id !== c.id),
                    }))
                  }
                >
                  Remove
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
