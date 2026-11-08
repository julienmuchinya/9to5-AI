/**
 * Reads a one-time verification code or link from the user's inbox while an application is open
 * (e.g. Greenhouse's "enter the 8-character code we emailed you", or "verify your email" links).
 * Read-only (Gmail API via "Connect with Google", or IMAP); never sends, deletes or marks mail as read.
 */

import type { Mailbox } from "./mailbox";
import { GmailAuthError } from "../../src/lib/v2/gmail";

/** Pulls the verification code out of an email body. */
/** Looks like a one-time code, not an ordinary word ("Hearst", "Application", "HTML"). */
const codeLike = (w: string) => {
  if (/^(19|20)\d\d$/.test(w)) return false; // a year
  if (/\d/.test(w)) return /[0-9]/.test(w) && w.length >= 4;
  // Letters only: needs real case-mixing inside the word (aB3dE5fG / kQxPzRtM), not a capitalised word.
  const upper = (w.match(/[A-Z]/g) ?? []).length;
  const lower = (w.match(/[a-z]/g) ?? []).length;
  return w.length >= 6 && upper >= 2 && lower >= 2 && !/^[A-Z][a-z]+$/.test(w) && !/^[A-Z]+[a-z]+$/.test(w);
};

export function extractCode(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  // 1. "…code …: XXXXXXXX" — the code right after a colon is the strongest signal.
  const colon = /(code|passcode|pin|otp)\b[^:\n]{0,120}:\s*([A-Za-z0-9]{4,12})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = colon.exec(t))) if (codeLike(m[2])) return m[2];
  // 2. "Your verification code is 482913" / a code token shortly after the word "code".
  const re = /(code|passcode|pin|one[- ]time password|otp)\b/gi;
  while ((m = re.exec(t))) {
    const window = t.slice(m.index + m[0].length, m.index + m[0].length + 220);
    const hit = (window.match(/\b[A-Za-z0-9]{4,12}\b/g) ?? []).find(codeLike);
    if (hit) return hit;
  }
  return null;
}

/** Pulls a verify/confirm/activate link out of an email (HTML or text). */
export function extractLink(html: string, text = "", host?: string): string | null {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((x) => x[1].replace(/&amp;/g, "&"));
  const urls = [...hrefs, ...(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])].filter(
    (u) => /^https?:/.test(u) && !/unsubscribe|privacy|help|terms|logo|\.(png|jpe?g|gif)(\?|$)/i.test(u)
  );
  const keyword = (u: string) => /(verif|confirm|activat|validate|email-?token|registration|reset|passwordchange|change-?password|forgot)/i.test(u);
  // With `host` (the portal, e.g. acme.wd5.myworkdayjobs.com) a link to that portal wins, and a portal link
  // carrying a token counts even without the word "verify" (Workday's ".../activate/<token>" style).
  const onHost = (u: string) => {
    try {
      return Boolean(host) && new URL(u).hostname.toLowerCase() === host!.toLowerCase();
    } catch {
      return false;
    }
  };
  return urls.find((u) => onHost(u) && keyword(u)) ?? urls.find(keyword) ?? urls.find((u) => onHost(u) && /(token|code|key)=|\/[A-Za-z0-9_-]{24,}/.test(u)) ?? null;
}

/** Codes/links already used in this process — never enter the same one twice (it belonged to an earlier application). */
const used = new Set<string>();

/**
 * Waits up to `timeoutMs` for an email that arrived after `since` and matches `match`
 * (tested against sender + subject), then returns its code or link.
 */
export async function waitForVerification(
  open: () => Promise<Mailbox>,
  opts: { since: Date; match: RegExp; want: "code" | "link"; timeoutMs?: number; log?: (m: string) => void; host?: string }
): Promise<string | null> {
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  const box = await open();
  const seen = new Set<string>();
  // Search by keyword so a busy inbox can't push the email out of the newest-N window.
  const hint = opts.want === "code" ? "{code passcode verification security}" : "{verify verification activate confirm account workday password reset}";
  try {
    while (Date.now() < deadline) {
      for (const m of await box.list(new Date(opts.since.getTime() - 60_000), 40, hint)) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        // Only emails sent after Submit: an earlier application to the same company (minutes before)
        // left its own code in the inbox, and entering that one makes the site reject the form.
        if (m.date && m.date.getTime() < opts.since.getTime() - 5_000) continue;
        if (!opts.match.test(`${m.from} ${m.subject}`)) {
          opts.log?.(`    skipped email: ${m.from.slice(0, 50)} | ${m.subject.slice(0, 70)}`);
          continue;
        }
        const { text, html } = await m.body();
        const found = opts.want === "code" ? extractCode(`${m.subject}\n${text}`) : extractLink(html, text, opts.host);
        if (found && !used.has(found)) {
          used.add(found);
          return found;
        }
        opts.log?.(`    no ${opts.want} in: ${m.from.slice(0, 50)} | ${m.subject.slice(0, 70)} (${text.length} chars)`);
      }
      await new Promise((r) => setTimeout(r, 6000));
    }
    return null;
  } finally {
    await box.close();
  }
}

/** Turns an IMAP error into something the user can act on. */
export function inboxErrorMessage(e: unknown): string {
  if (e instanceof GmailAuthError) return e.message;
  const err = e as { message?: string; responseText?: string; authenticationFailed?: boolean };
  const text = `${err.responseText ?? ""} ${err.message ?? ""}`;
  if (err.authenticationFailed || /invalid credentials|authenticat|AUTHENTICATIONFAILED|login/i.test(text))
    return "Gmail rejected the password. Use a 16-letter Gmail app password (myaccount.google.com/apppasswords), not your normal Gmail password.";
  if (/IMAP access is disabled|imap.*disabled/i.test(text)) return "IMAP is turned off for this Gmail account — turn it on in Gmail settings → Forwarding and POP/IMAP.";
  return (err.responseText || err.message || String(e)).slice(0, 200);
}
