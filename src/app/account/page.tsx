import { requireUser } from "@/lib/v2/session";
import { Card, PageHeader } from "@/components/ui";
import { SecurityQuestionsEditor } from "@/components/security-questions";
import { hasSecurityQuestions } from "../auth-actions";
import { ChangePasswordForm } from "./change-password";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { user } = await requireUser();
  const { reset } = await searchParams;
  const hasQ = await hasSecurityQuestions();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Account & security" description={`Signed in as ${user.email}`} />
      {reset && (
        <p className="mb-6 rounded-lg bg-amber-900/30 p-3 text-sm text-amber-300">
          You opened a password-reset link. Choose a new password below.
        </p>
      )}
      <Card className="mb-6">
        <h2 className="mb-4 font-semibold">Change password</h2>
        <ChangePasswordForm />
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Security questions</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">Used to reset your password if you can’t get the email code. All three must be answered correctly.</p>
        {!hasQ && <p className="mb-4 rounded-lg bg-amber-900/30 p-3 text-sm text-amber-300">You haven’t set these yet — set them now so you can never get locked out.</p>}
        <SecurityQuestionsEditor hasExisting={hasQ} />
      </Card>
    </div>
  );
}
