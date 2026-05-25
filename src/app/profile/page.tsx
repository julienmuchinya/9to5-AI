"use client";

import { useLocalStore } from "@/hooks/use-store";
import { Button, Card, PageHeader } from "@/components/ui";

export default function ProfilePage() {
  const { store, update, ready } = useLocalStore();

  if (!ready || !store) return <p>Loading…</p>;

  const p = store.profile;

  return (
    <div>
      <PageHeader title="Profile" description="Your job search profile for 9to5 AI" />
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            update((s) => ({
              ...s,
              profile: {
                ...s.profile,
                full_name: String(fd.get("full_name") ?? ""),
                school: String(fd.get("school") ?? ""),
                job_email: String(fd.get("job_email") ?? ""),
                location_preference: String(fd.get("location") ?? ""),
                work_mode: String(fd.get("work_mode") ?? ""),
                skills: String(fd.get("skills") ?? "")
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
                target_roles: String(fd.get("target_roles") ?? "")
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
            }));
          }}
        >
          <Field label="Full name" name="full_name" defaultValue={p.full_name} />
          <Field label="School" name="school" defaultValue={p.school} />
          <Field label="Job-search email" name="job_email" defaultValue={p.job_email} />
          <Field label="Location preference" name="location" defaultValue={p.location_preference} />
          <Field label="Work mode" name="work_mode" defaultValue={p.work_mode} />
          <Field label="Skills (comma-separated)" name="skills" defaultValue={p.skills?.join(", ")} />
          <Field label="Target roles (comma-separated)" name="target_roles" defaultValue={p.target_roles?.join(", ")} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="relocation" defaultChecked={p.relocation} />
            Open to relocation
          </label>
          <Button type="submit">Save profile</Button>
        </form>
      </Card>
    </div>
  );
}

function Field({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm text-[var(--muted)]">{label}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
      />
    </div>
  );
}
