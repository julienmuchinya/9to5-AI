/**
 * Reads the user's inbox (Gmail API via "Connect with Google", or IMAP + app password; both free) and updates application statuses
 * from recruiter emails: received → under review → interview → offer / rejected.
 * Only reads; never sends, deletes or marks mail as read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { openMailbox, type Mailbox } from "./mailbox";
import { GmailRateLimitError } from "../../src/lib/v2/gmail";
import { inboxErrorMessage } from "./mailcode";
import { classifyEmail, emailMentionsCompany, nextStatus } from "../../src/lib/v2/tracking";

type InboxUser = { id: string; inbox_email: string | null; inbox_host: string | null; inbox_password_enc: string | null; inbox_last_scan_at: string | null };

export async function scanInbox(sb: SupabaseClient, u: InboxUser, log: (m: string) => void): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!u.inbox_email || !u.inbox_password_enc) return out;

  const { data: apps } = await sb
    .from("applications")
    .select("id,status,created_at, jobs(company_name,title)")
    .eq("user_id", u.id)
    .in("status", ["submitted", "received", "under_review", "screening", "interview", "needs_user"]);
  type App = { id: string; status: string; created_at: string; jobs: { company_name: string; title: string } | null };
  const open = ((apps ?? []) as unknown as App[]).filter((a) => a.jobs?.company_name);
  if (!open.length) return out;

  const since = new Date(Math.max(Date.now() - 30 * 86400_000, u.inbox_last_scan_at ? new Date(u.inbox_last_scan_at).getTime() - 86400_000 : 0));
  let box: Mailbox | null = null;
  try {
    box = await openMailbox(u);
    // Only mail that could be about an application (Gmail search does the filtering — far fewer API calls).
    const hint = "{application applying applied interview candidate position role offer thank opportunity update status}";
    for (const msg of await box.list(since, 150, hint)) {
      const from = msg.from;
      const subject = msg.subject;
      // Cheap pre-filter on subject before downloading the body.
      const quick = classifyEmail(subject, "");
      const maybe = quick || /(application|candidate|interview|position|role|opportunity|thank you|update)/i.test(subject);
      if (!maybe) continue;
      const body = (await msg.body()).text.slice(0, 6000);
      const stage = classifyEmail(subject, body);
      if (!stage) continue;
      const when = msg.date ?? new Date();
      const app = open.find((x) => new Date(x.created_at).getTime() - 86400_000 <= when.getTime() && emailMentionsCompany(x.jobs!.company_name, from, subject, body));
      if (!app) continue;

      const { error } = await sb.from("application_events").insert({
        user_id: u.id,
        application_id: app.id,
        kind: stage,
        source: "email",
        detail: subject.slice(0, 300),
        message_id: msg.id,
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
    await sb.from("profiles").update({ inbox_last_scan_at: new Date().toISOString(), inbox_error: null }).eq("id", u.id);
  } catch (e) {
    const friendly = inboxErrorMessage(e);
    // A temporary Gmail rate limit must not mark the inbox as broken (that switched off security-code reading).
    if (e instanceof GmailRateLimitError || /quota|rate ?limit|429/i.test(friendly)) {
      log(`inbox ${u.id.slice(0, 8)}: Gmail rate limit — will scan again next run`);
    } else {
      await sb.from("profiles").update({ inbox_error: friendly }).eq("id", u.id);
      log(`inbox ${u.id.slice(0, 8)} error: ${friendly}`);
    }
  } finally {
    await box?.close().catch(() => {});
  }
  return out;
}
