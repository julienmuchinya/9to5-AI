import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpUsage, readUsage } from "../../src/lib/v2/freeTier";
import { GmailScopeError, gmailAccessToken, gmailSend } from "../../src/lib/v2/gmail";
import { NEEDS_LABEL, needsKind, type NeedsKind } from "../../src/lib/v2/needs";
import { statsByResume, statusRows, type ResumeStats } from "../../src/lib/v2/pipeline";
import { loadLibrary } from "../../src/lib/v2/resume-library";
import { decryptSecret } from "../../src/lib/v2/vault";
import { isGoogleConnected } from "./mailbox";

/**
 * The email summary, sent from the user's connected Gmail to their own address:
 *  - after every run they start themselves ("Run now"),
 *  - once a day from a scheduled run (the first one after 12:00 UTC),
 *  - with a weekly resume report on Mondays.
 * Needs the Gmail "send" permission (reconnect Google once after this was added).
 */
export interface DigestData {
  name: string;
  appUrl: string;
  manual: boolean;
  /** Sent since the window start (this run, or the last day). */
  sent: { company: string; title: string }[];
  needs: { company: string; title: string; kind: NeedsKind; why: string }[];
  queued: number;
  weekly?: { label: string; stats: ResumeStats }[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildDigest(d: DigestData): { subject: string; text: string; html: string } {
  const subject = d.needs.length
    ? `9to5 AI: ${d.sent.length} sent, ${d.needs.length} need you`
    : `9to5 AI: ${d.sent.length} application${d.sent.length === 1 ? "" : "s"} sent${d.manual ? " (your run)" : " today"}`;
  const groups = new Map<NeedsKind, DigestData["needs"]>();
  for (const n of d.needs) groups.set(n.kind, [...(groups.get(n.kind) ?? []), n]);
  const needsUrl = `${d.appUrl}/applications?tab=needs`;

  const text: string[] = [`Hi ${d.name},`, ""];
  const html: string[] = [`<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#0f172a;max-width:560px">`, `<p>Hi ${esc(d.name)},</p>`];

  const head = `${d.manual ? "Your run" : "In the last day"} the agent sent ${d.sent.length} application${d.sent.length === 1 ? "" : "s"}${d.queued ? `; ${d.queued} more are queued for the next runs` : ""}.`;
  text.push(head);
  html.push(`<p>${esc(head)}</p>`);
  if (d.sent.length) {
    text.push(...d.sent.slice(0, 15).map((s) => `  ✓ ${s.company} — ${s.title}`), d.sent.length > 15 ? `  …and ${d.sent.length - 15} more` : "");
    html.push(`<ul style="padding-left:18px;margin:4px 0 12px">${d.sent.slice(0, 15).map((s) => `<li>${esc(s.company)} — ${esc(s.title)}</li>`).join("")}${d.sent.length > 15 ? `<li>…and ${d.sent.length - 15} more</li>` : ""}</ul>`);
  }

  if (d.needs.length) {
    text.push("", `${d.needs.length} need you:`);
    html.push(`<h3 style="font-size:15px;margin:16px 0 4px">${d.needs.length} need you</h3>`);
    for (const [kind, list] of groups) {
      const l = NEEDS_LABEL[kind];
      text.push(`- ${l.label} (${list.length}): ${l.hint}`, ...list.slice(0, 8).map((n) => `    • ${n.company} — ${n.title}`));
      html.push(
        `<p style="margin:10px 0 2px"><b>${esc(l.label)}</b> (${list.length}) <span style="color:#64748b">— ${esc(l.hint)}</span></p>`,
        `<ul style="padding-left:18px;margin:2px 0">${list.slice(0, 8).map((n) => `<li>${esc(n.company)} — ${esc(n.title)}</li>`).join("")}${list.length > 8 ? `<li>…and ${list.length - 8} more</li>` : ""}</ul>`
      );
    }
    text.push("", `Open them: ${needsUrl}`);
    html.push(`<p style="margin:16px 0"><a href="${needsUrl}" style="background:#0f172a;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">Open Needs you</a></p>`);
  } else {
    text.push("", "Nothing needs you right now.");
    html.push(`<p style="color:#047857">Nothing needs you right now.</p>`);
  }

  if (d.weekly?.length) {
    const ranked = [...d.weekly].sort((a, b) => b.stats.rate - a.stats.rate || b.stats.sent - a.stats.sent);
    const best = ranked.find((r) => r.stats.sent >= 5);
    text.push("", "Weekly resume report (last 7 days):", ...ranked.map((r) => `  ${r.label}: ${r.stats.sent} sent, ${r.stats.progressed} moved on, ${r.stats.interviews} interviews, ${r.stats.rejected} rejected — ${Math.round(r.stats.rate * 100)}% response`));
    html.push(
      `<h3 style="font-size:15px;margin:20px 0 4px">Weekly resume report</h3>`,
      `<table style="border-collapse:collapse;font-size:13px">${ranked
        .map((r) => `<tr><td style="padding:3px 12px 3px 0"><b>${esc(r.label)}</b></td><td style="padding:3px 12px 3px 0">${r.stats.sent} sent</td><td style="padding:3px 12px 3px 0">${r.stats.progressed} moved on</td><td style="padding:3px 12px 3px 0">${r.stats.interviews} interviews</td><td>${Math.round(r.stats.rate * 100)}% response</td></tr>`)
        .join("")}</table>`
    );
    const tip =
      best && ranked.length > 1
        ? `${best.label} is getting the best response this week. The agent already picks the best-fitting resume per job; consider making ${best.label} your main resume, or tightening the others toward it.`
        : ranked.length === 1
          ? "Add a second resume (for example one aimed at a different kind of role) to compare which gets more responses."
          : "Not enough sent yet this week to tell which resume works better.";
    text.push(tip);
    html.push(`<p style="color:#334155">${esc(tip)}</p>`);
  }
  text.push("", `Dashboard: ${d.appUrl}/dashboard`);
  html.push(`<p style="color:#94a3b8;font-size:12px;margin-top:24px">Sent by your 9to5 AI agent from your own Gmail. <a href="${d.appUrl}/dashboard" style="color:#94a3b8">Dashboard</a></p></div>`);
  return { subject, text: text.filter((x) => x !== undefined).join("\n"), html: html.join("") };
}

interface DigestUser {
  id: string;
  full_name: string | null;
  first_name: string | null;
  inbox_email: string | null;
  inbox_host: string | null;
  inbox_password_enc: string | null;
  resume_path?: string | null;
  resume_parsed?: unknown;
  resume_updated_at?: string | null;
}

/** When to send: always after a manual run; else once a day, from the first scheduled run after 12:00 UTC. */
export async function digestDue(sb: SupabaseClient, userId: string, manual: boolean, now = new Date()): Promise<boolean> {
  if (manual) return true;
  if (now.getUTCHours() < 12) return false;
  return (await readUsage(sb, "digest_sent", userId).catch(() => 1)) === 0;
}

export async function sendRunDigest(
  sb: SupabaseClient,
  u: DigestUser,
  opts: { manual: boolean; since: Date; log: (m: string) => void }
): Promise<"sent" | "skipped" | "no_permission" | "no_gmail"> {
  if (process.env.DIGEST === "false") return "skipped";
  if (!(await digestDue(sb, u.id, opts.manual))) return "skipped";
  if (!u.inbox_email || !u.inbox_password_enc || !isGoogleConnected(u)) return "no_gmail";
  // Google told us at connect time that sending wasn't allowed (migration 010): don't try, don't warn every run.
  const scopes = (u as { inbox_scopes?: string | null }).inbox_scopes;
  if (scopes != null && !/gmail\.send/.test(scopes)) return "no_permission";

  const windowStart = opts.manual ? opts.since : new Date(Date.now() - 24 * 3600_000);
  const [{ data: sentRows }, { data: needRows }, { count: queued }] = await Promise.all([
    sb.from("applications").select("jobs(title,company_name)").eq("user_id", u.id).gte("submitted_at", windowStart.toISOString()).limit(200),
    sb.from("applications").select("error,pending_questions,jobs(title,company_name)").eq("user_id", u.id).eq("status", "needs_user").order("status_updated_at", { ascending: false }).limit(60),
    sb.from("applications").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("status", "queued"),
  ]);
  type J = { jobs: { title: string; company_name: string } | null };
  const sent = ((sentRows ?? []) as unknown as J[]).map((r) => ({ company: r.jobs?.company_name ?? "?", title: r.jobs?.title ?? "?" }));
  const needs = ((needRows ?? []) as unknown as (J & { error: string | null; pending_questions: unknown[] | null })[]).map((r) => ({
    company: r.jobs?.company_name ?? "?",
    title: r.jobs?.title ?? "?",
    kind: needsKind(r.error, r.pending_questions?.length ?? 0),
    why: r.error ?? "",
  }));

  // Weekly resume report on Mondays (UTC), from the scheduled daily email.
  let weekly: DigestData["weekly"];
  if (!opts.manual && new Date().getUTCDay() === 1) {
    const lib = await loadLibrary(sb, u.id, u as never).catch(() => null);
    const labels = lib?.resumes.map((r) => r.label) ?? [];
    const mainLabel = lib?.resumes.find((r) => r.id === "main")?.label ?? labels[0] ?? "Main resume";
    const rows = (await statusRows(sb, u.id)).filter((r) => (r.submitted_at ?? "") >= new Date(Date.now() - 7 * 24 * 3600_000).toISOString());
    weekly = [...statsByResume(rows, labels, mainLabel)].map(([label, stats]) => ({ label, stats }));
  }

  const { data: auth } = await sb.auth.admin.getUserById(u.id);
  const to = auth?.user?.email || u.inbox_email;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL && !/localhost/.test(process.env.NEXT_PUBLIC_APP_URL) ? process.env.NEXT_PUBLIC_APP_URL : "https://9to5-ai.vercel.app").replace(/\/$/, "");
  const mail = buildDigest({ name: u.first_name || (u.full_name ?? "").split(" ")[0] || "there", appUrl, manual: opts.manual, sent, needs, queued: queued ?? 0, weekly });
  try {
    const token = await gmailAccessToken(decryptSecret(u.inbox_password_enc));
    await gmailSend(token, { to, ...mail });
    if (!opts.manual) await bumpUsage(sb, "digest_sent", 1, u.id).catch(() => {});
    opts.log(`  summary email sent (${mail.subject})`);
    return "sent";
  } catch (e) {
    if (e instanceof GmailScopeError) {
      opts.log("  summary email not sent: reconnect Google once to allow sending");
      // Remember it (when the column exists) so later runs skip quietly; otherwise warn at most once a day.
      const { error: saveErr } = await sb.from("profiles").update({ inbox_scopes: "gmail.readonly" }).eq("id", u.id);
      if (saveErr) {
        const { count } = await sb.from("agent_logs").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("metadata->>area", "digest").gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
        if (!count) await sb.from("agent_logs").insert({ user_id: u.id, level: "warn", message: e.message, metadata: { area: "digest" } });
      }
      return "no_permission";
    }
    opts.log(`  summary email failed: ${(e as Error).message.slice(0, 160)}`);
    return "skipped";
  }
}
