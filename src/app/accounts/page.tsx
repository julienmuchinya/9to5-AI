import { requireUser } from "@/lib/v2/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { deletePortalAccount, markPortalCreated, savePortalAccount } from "../vault-actions";
import { RevealPassword } from "./reveal";

export const dynamic = "force-dynamic";

const input = "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm";

export default async function PortalAccountsPage() {
  const { supabase, user } = await requireUser();
  const [{ data: rows }, { data: apps }] = await Promise.all([
    supabase
      .from("application_accounts")
      .select("id,company_name,portal_host,login_url,email_used,created_by,account_created,notes,created_at")
      .eq("user_id", user.id)
      .order("company_name"),
    supabase.from("applications").select("apply_url").eq("user_id", user.id),
  ]);
  const countByHost: Record<string, number> = {};
  for (const a of apps ?? []) {
    try {
      const h = new URL(a.apply_url ?? "").hostname.toLowerCase();
      countByHost[h] = (countByHost[h] ?? 0) + 1;
    } catch {
      // skip bad URLs
    }
  }
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Career portal logins"
        description="One login per company portal, reused for every job there. Passwords are encrypted; only you can reveal them."
      />
      <Card className="mb-6 text-sm text-[var(--muted)]">
        When a job needs an account (Workday, iCIMS, Taleo and similar), the agent prepares a strong password here and sends the job to{" "}
        <b>Applications → Needs you</b>. Create the account on that site with the email and password shown, click “Account created”, and every
        future job at that company uses the same login.
      </Card>
      {(rows ?? []).length === 0 && <EmptyState message="No portal logins yet. They appear when a job needs an account, or add one below." />}
      <div className="mb-8 space-y-3">
        {(rows ?? []).map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {r.company_name}{" "}
                  <Badge variant={r.account_created ? "success" : "warning"}>{r.account_created ? "Account created" : "Not created yet"}</Badge>
                </p>
                <a href={r.login_url ?? `https://${r.portal_host}`} target="_blank" rel="noopener noreferrer" className="block text-sm text-[var(--accent)]">
                  {r.portal_host}
                </a>
                <p className="text-sm">
                  Email: <code className="rounded bg-[var(--background)] px-2 py-1">{r.email_used}</code>
                </p>
                <div className="text-sm">
                  Password: <RevealPassword id={r.id} />
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {countByHost[r.portal_host ?? ""] ?? 0} application(s) on this portal · added by {r.created_by}
                  {r.notes ? ` · ${r.notes}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {!r.account_created && (
                  <form action={markPortalCreated.bind(null, r.id)}>
                    <button className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white">Account created</button>
                  </form>
                )}
                <form action={deletePortalAccount.bind(null, r.id)}>
                  <button className="rounded-lg bg-[var(--border)] px-3 py-1.5 text-sm">Delete</button>
                </form>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="mb-4 font-semibold">Add or update a login</h2>
        <form action={savePortalAccount} className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            Company
            <input className={input} name="company_name" placeholder="Acme Corp" />
          </label>
          <label className="block text-sm">
            Portal link
            <input className={input} name="login_url" placeholder="acme.wd5.myworkdayjobs.com" required />
          </label>
          <label className="block text-sm">
            Email used
            <input className={input} name="email_used" type="email" defaultValue={user.email ?? ""} />
          </label>
          <label className="block text-sm">
            Password (leave blank to generate a strong one)
            <input className={input} name="password" type="password" autoComplete="new-password" />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="account_created" /> I already created this account
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>Save login</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
