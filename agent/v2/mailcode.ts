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

/**
 * `length`: the code length the site expects (Greenhouse: always 8 characters). When given, a token of
 * exactly that length wins over an earlier code-like word of another length.
 */
export function extractCode(text: string, length?: number): string | null {
  const t = text.replace(/\s+/g, " ");
  const candidates: string[] = [];
  // 1. "…code …: XXXXXXXX" — the code right after a colon is the strongest signal.
  const colon = /(code|passcode|pin|otp)\b[^:\n]{0,120}:\s*([A-Za-z0-9]{4,12})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = colon.exec(t))) if (codeLike(m[2]) || (length && m[2].length === length && /[A-Za-z]/.test(m[2]) && /[0-9]/.test(m[2]))) candidates.push(m[2]);
  // 2. "Your verification code is 482913" / a code token shortly after the word "code".
  const re = /(code|passcode|pin|one[- ]time password|otp)\b/gi;
  while ((m = re.exec(t))) {
    const window = t.slice(m.index + m[0].length, m.index + m[0].length + 220);
    for (const w of window.match(/\b[A-Za-z0-9]{4,12}\b/g) ?? []) if (codeLike(w)) candidates.push(w);
  }
  if (length) {
    const exact = candidates.find((c) => c.length === length);
    if (exact) return exact;
  }
  return candidates[0] ?? null;
}

/** Pulls a verify/confirm/activate link out of an email (HTML or text). */
export function extractLink(html: string, text = "", host?: string): string | null {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((x) => x[1].replace(/&amp;/g, "&"));
  const urls = [...hrefs, ...(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])].filter(
    (u) => /^https?:/.test(u) && !/unsubscribe|privacy|help|terms|logo|\.(png|jpe?g|gif)(\?|$)/i.test(u)
  );
  const keyword = (u: string) => /(verif|confirm|activat|validate|email-?token|registration|reset|passwordchange|change-?password|forgot)/i.test(u);
  if (host) {
    // A portal (one company's Workday site): ONLY that company's link. Falling back to "any reset link" opened another
    // company's password-reset email (Vertex used Russell Investments' link) and changed the wrong account's password.
    const tenant = host.toLowerCase().split(".")[0];
    const ours = (u: string) => {
      try {
        const x = new URL(u);
        const h = x.hostname.toLowerCase();
        if (h === host.toLowerCase()) return true;
        return /(^|\.)myworkday(jobs|site)?\.com$/.test(h) && (h.startsWith(`${tenant}.`) || x.pathname.toLowerCase().split("/").includes(tenant));
      } catch {
        return false;
      }
    };
    const mine = urls.filter(ours);
    return mine.find(keyword) ?? mine.find((u) => /(token|code|key)=|\/[A-Za-z0-9_-]{24,}/.test(u)) ?? null;
  }
  return urls.find(keyword) ?? null;
}

/** Does the email mention this company (its first distinctive word)? Unknown wording → yes. */
function mentions(hay: string, company: string): boolean {
  const word = company
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .find((w) => w.length >= 3 && !["the", "inc", "llc", "corp", "group", "company", "technologies"].includes(w));
  return !word || hay.toLowerCase().includes(word);
}

/** Codes/links already used in this process — never enter the same one twice (it belonged to an earlier application). */
const used = new Set<string>();

/**
 * Waits up to `timeoutMs` for an email that arrived after `since` and matches `match`
 * (tested against sender + subject), then returns its code or link.
 */
export async function waitForVerification(
  open: () => Promise<Mailbox>,
  opts: { since: Date; match: RegExp; want: "code" | "link"; timeoutMs?: number; log?: (m: string) => void; host?: string; mention?: string }
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
        // Several applications run at once: skip a code email that names a different company.
        if (opts.mention && !mentions(`${m.from} ${m.subject} ${text.slice(0, 3000)}`, opts.mention)) continue;
        // Greenhouse codes are always 8 characters ("enter the 8-character code").
        const want = /greenhouse/i.test(`${m.from} ${m.subject}`) || /8-character/i.test(text) ? 8 : undefined;
        const found = opts.want === "code" ? extractCode(`${m.subject}\n${text}`, want) : extractLink(html, text, opts.host);
        if (found && !used.has(found)) {
          used.add(found);
          // Never the code itself in logs — only where it came from and its length, to spot a wrong pick.
          if (opts.want === "code") opts.log?.(`    code from "${m.subject.slice(0, 60)}" (${found.length} chars${want && found.length !== want ? `, expected ${want}` : ""})`);
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
