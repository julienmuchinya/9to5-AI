"use client";

import { useState } from "react";
import { useLocalStore } from "@/hooks/use-store";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

export default function EvidencePage() {
  const { store, update, ready } = useLocalStore();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("skill");

  if (!ready || !store) return <p>Loading…</p>;

  const add = () => {
    if (!title.trim()) return;
    update((s) => ({
      ...s,
      evidence_bank: [
        ...s.evidence_bank,
        {
          id: crypto.randomUUID(),
          category,
          title: title.trim(),
          content: content.trim(),
          skills: [],
          tools: [],
          approved: false,
        },
      ],
    }));
    setTitle("");
    setContent("");
  };

  return (
    <div>
      <PageHeader
        title="Evidence Bank"
        description="Only approved facts may appear on resumes, cover letters, and applications"
      />
      <Card className="mb-6 space-y-3">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
          <option value="skill">Skill</option>
          <option value="project">Project</option>
          <option value="work">Work</option>
          <option value="education">Education</option>
        </select>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
        <textarea placeholder="Content / proof" value={content} onChange={(e) => setContent(e.target.value)} rows={3} className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
        <Button onClick={add}>Add evidence</Button>
      </Card>
      <ul className="space-y-2">
        {store.evidence_bank.map((e) => (
          <li key={e.id}>
            <Card className="flex justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge>{e.category}</Badge>
                  <span className="font-medium">{e.title}</span>
                  {e.approved && <Badge variant="success">Approved</Badge>}
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">{e.content}</p>
              </div>
              {!e.approved && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    update((s) => ({
                      ...s,
                      evidence_bank: s.evidence_bank.map((x) =>
                        x.id === e.id ? { ...x, approved: true } : x
                      ),
                    }))
                  }
                >
                  Approve
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
