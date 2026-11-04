/**
 * Reads the user's inbox (IMAP + app password, free) and updates application statuses
 * from recruiter emails: received → under review → interview → offer / rejected.
 * Only reads; never sends, deletes or marks mail as read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "../../src/lib/v2/vault";
import { classifyEmail, emailMentionsCompany, nextStatus } from "../../src/lib/v2/tracking";

type InboxUser = { id: string; inbox_email: string | null; inbox_host: string | null; inbox_password_enc: string | null; inbox_last_scan_at: string | null };

export async function scanInbox(sb: SupabaseClient, u: InboxUser, log: (m: string) => void): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!u.inbox_email || !u.inbox_password_enc) return out;

  const { data: apps } = await sb
    .from("applications")
    .select("id,status,created_at, jobs(company_name,title)")
    .eq("user_id", u.id)
    .in("status", ["submitted", "received", "under_review", "interview", "needs_user"]);
  type App = { id: string; status: string; created_at: string; jobs: { company_name: string; title: string } | null };
  const open = ((apps ?? []) as unknown as App[]).filter((a) => a.jobs?.company_name);
  if (!open.length) return out;

  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({
    host: u.inbox_host || "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: u.inbox_email, pass: decryptSecret(u.inbox_password_enc) },
    logger: false,
  });

  const since = new Date(Math.max(Date.now() - 30 * 86400_000, u.inbox_last_scan_at ? new Date(u.inbox_last_scan_at).getTime() - 86400_000 : 0));
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = ((await client.search({ since }, { uid: true })) || []) as number[];
      const recent = uids.slice(-300); // cap work per run
      for await (const msg of client.fetch(recent, { uid: true, envelope: true, source: { start: 0, maxLength: 60_000 } }, { uid: true })) {
        const from = (msg.envelope?.from ?? []).map((f) => `${f.name ?? ""} ${f.address ?? ""}`).join(" ");
        const subject = msg.envelope?.subject ?? "";
        const messageId = msg.envelope?.messageId ?? `uid:${msg.uid}`;
        // Cheap pre-filter on subject before parsing the body.
        const quick = classifyEmail(subject, "");
        const maybe = quick || /(application|candidate|interview|position|role|opportunity|thank you|update)/i.test(subject);
        if (!maybe) continue;
        let body = "";
        if (msg.source) {
          const parsed = await simpleParser(msg.source);
          body = (parsed.text ?? "").slice(0, 6000);
        }
        const stage = classifyEmail(subject, body);
        if (!stage) continue;
        const when = msg.envelope?.date ? new Date(msg.envelope.date) : new Date();
        const app = open.find((a) => new Date(a.created_at).getTime() - 86400_000 <= when.getTime() && emailMentionsCompany(a.jobs!.company_name, from, subject, body));
        if (!app) continue;

        const { error } = await sb.from("application_events").insert({
          user_id: u.id,
          application_id: app.id,
          kind: stage,
          source: "email",
          detail: subject.slice(0, 300),
          message_id: messageId,
          created_at: when.toISOString(),
        });
        if (error) continue; // duplicate message already recorded
        const status = nextStatus(app.status, stage);
        if (status !== app.status) {
          await sb.from("applications").update({ status, status_updated_at: new Date().toISOString(), last_email_at: when.toISOString() }).eq("id", app.id);
          app.status = status;
        } else {
          await sb.from("applications").update({ last_email_at: when.toISOString() }).eq("id", app.id);
        }
        out[stage] = (out[stage] ?? 0) + 1;
        log(`inbox ${u.id.slice(0, 8)}: ${app.jobs!.company_name} → ${stage}`);
      }
    } finally {
      lock.release();
    }
    await client.logout();
    await sb.from("profiles").update({ inbox_last_scan_at: new Date().toISOString(), inbox_error: null }).eq("id", u.id);
  } catch (e) {
    const m = (e as Error).message ?? String(e);
    const friendly = /auth|credentials|invalid|login/i.test(m) ? "Inbox sign-in failed — check the email and app password on the Autopilot page." : m.slice(0, 200);
    await sb.from("profiles").update({ inbox_error: friendly }).eq("id", u.id);
    log(`inbox ${u.id.slice(0, 8)} error: ${friendly}`);
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
  return out;
}
