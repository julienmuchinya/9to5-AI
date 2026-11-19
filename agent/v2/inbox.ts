/**
 * Reads the user's inbox (Gmail API via "Connect with Google", or IMAP + app password; both free) and updates application statuses
 * from recruiter emails: received → under review → interview → offer / rejected.
 * Only reads; never sends, deletes or marks mail as read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { openMailbox, type Mailbox } from "./mailbox";
import { GmailRateLimitError } from "../../src/lib/v2/gmail";
import { inboxErrorMessage } from "./mailcode";
import { classifyEmail, emailMentionsCompany, nextStatus, statusFromEvents, titleOverlap } from "../../src/lib/v2/tracking";

type InboxUser = { id: string; inbox_email: string | null; inbox_host: string | null; inbox_password_enc: string | null; inbox_last_scan_at: string | null };

/** Stages an email can set that, if wrong, make the timeline say something happened that didn't. */
const CHECKED = ["under_review", "screening", "interview", "offer", "rejected"];

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

  const since = new Date(Math.max(Date.now() - 30 * 86400_000, u.inbox_last_scan_at ? new Date(u.inbox_last_scan_at).getTime() - 86400_000 : 0));
  let box: Mailbox | null = null;
  try {
    box = await openMailbox(u);
    // Statuses set by earlier emails under looser rules: read those emails again and undo the ones that don't hold up.
    const fixed = await recheckEmailStages(sb, u.id, box, log).catch((e) => {
      log(`inbox ${u.id.slice(0, 8)}: recheck skipped (${(e as Error).message.slice(0, 120)})`);
      return 0;
    });
    if (fixed) out.corrected = fixed;
    if (!open.length) {
      await sb.from("profiles").update({ inbox_last_scan_at: new Date().toISOString(), inbox_error: null }).eq("id", u.id);
      return out;
    }
    // Only mail that could be about an application (Gmail search does the filtering — far fewer API calls).
    const hint = "{application applying applied interview candidate position role offer thank opportunity update status assessment}";
    for (const msg of await box.list(since, 150, hint)) {
      const from = msg.from;
      const subject = msg.subject;
      // Cheap pre-filter on subject before downloading the body.
      const quick = classifyEmail(subject, "", from);
      const maybe = quick || /(application|candidate|interview|position|role|opportunity|thank you|update|assessment|next steps)/i.test(subject);
      if (!maybe) continue;
      const body = (await msg.body()).text.slice(0, 6000);
      const stage = classifyEmail(subject, body, from);
      if (!stage) continue;
      const when = msg.date ?? new Date();
      // Every application at that company the email could be about; the one whose job title it names wins,
      // else the most recent one (never an arbitrary one).
      const candidates = open
        .filter((x) => new Date(x.created_at).getTime() - 86400_000 <= when.getTime() && emailMentionsCompany(x.jobs!.company_name, from, subject, body))
        .map((x) => ({ x, score: titleOverlap(x.jobs!.title, subject, body) }))
        .sort((a, b) => b.score - a.score || Date.parse(b.x.created_at) - Date.parse(a.x.created_at));
      if (!candidates.length) continue;
      // Several applications at one company and the email names none of their titles: only safe for "received".
      if (candidates.length > 1 && candidates[0].score === 0 && stage !== "received" && stage !== "rejected") {
        log(`inbox ${u.id.slice(0, 8)}: ${stage} email from ${candidates[0].x.jobs!.company_name} matches ${candidates.length} applications — left for you`);
        continue;
      }
      const app = candidates[0].x;

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

/**
 * Re-reads the emails behind "In review / Screening / Interview / Offer / Rejected" and removes the timeline
 * events the current rules don't confirm (a "thanks for applying — we may invite you to interview" email,
 * a job-alert newsletter, the wrong application at the same company). The status is then rebuilt from the
 * events that remain. Applications you updated yourself are left alone.
 */
async function recheckEmailStages(sb: SupabaseClient, userId: string, box: Mailbox, log: (m: string) => void): Promise<number> {
  const { data: apps } = await sb
    .from("applications")
    .select("id,status,submitted_at, jobs(company_name,title)")
    .eq("user_id", userId)
    .in("status", CHECKED)
    .gte("status_updated_at", new Date(Date.now() - 90 * 86400_000).toISOString())
    .limit(60);
  type A = { id: string; status: string; submitted_at: string | null; jobs: { company_name: string; title: string } | null };
  const list = ((apps ?? []) as unknown as A[]).filter((a) => a.jobs?.company_name);
  if (!list.length) return 0;
  const { data: evs } = await sb
    .from("application_events")
    .select("id,application_id,kind,source,message_id,created_at")
    .in(
      "application_id",
      list.map((a) => a.id)
    )
    .order("created_at", { ascending: true });
  type E = { id: string; application_id: string; kind: string; source: string; message_id: string | null; created_at: string };
  const byApp = new Map<string, E[]>();
  for (const e of (evs ?? []) as E[]) byApp.set(e.application_id, [...(byApp.get(e.application_id) ?? []), e]);

  let fixed = 0;
  let reads = 0;
  for (const a of list) {
    const events = byApp.get(a.id) ?? [];
    // You set a stage yourself: your record wins.
    if (events.some((e) => e.source === "user" && CHECKED.includes(e.kind))) continue;
    const suspects = events.filter((e) => e.source === "email" && e.message_id && CHECKED.includes(e.kind));
    if (!suspects.length) continue;
    const drop: string[] = [];
    for (const e of suspects) {
      if (reads >= 40) break; // a few dozen reads per run at most
      reads++;
      const m = await box.get(e.message_id!).catch(() => null);
      if (!m) continue; // can't read it again: leave it as it is
      const stage = classifyEmail(m.subject, m.text, m.from);
      const same = emailMentionsCompany(a.jobs!.company_name, m.from, m.subject, m.text);
      if (!same || stage !== e.kind) {
        // Still a confirmation of this application? Keep it as "received" rather than dropping it.
        if (same && stage === "received") await sb.from("application_events").update({ kind: "received" }).eq("id", e.id);
        else drop.push(e.id);
        e.kind = same && stage === "received" ? "received" : "__dropped";
      }
    }
    const changed = suspects.some((e) => e.kind === "__dropped" || e.kind === "received");
    if (!changed) continue;
    if (drop.length) await sb.from("application_events").delete().in("id", drop);
    const status = statusFromEvents(
      "submitted",
      events.filter((e) => e.kind !== "__dropped").map((e) => e.kind)
    );
    if (status !== a.status) {
      await sb.from("applications").update({ status, status_updated_at: new Date().toISOString() }).eq("id", a.id);
      await sb.from("application_events").insert({ user_id: userId, application_id: a.id, kind: "note", source: "agent", detail: `Corrected: an email had marked this “${a.status.replace("_", " ")}”, but it didn’t say that about this application.` });
      fixed++;
      log(`inbox ${userId.slice(0, 8)}: ${a.jobs!.company_name} corrected ${a.status} → ${status}`);
    }
  }
  return fixed;
}
