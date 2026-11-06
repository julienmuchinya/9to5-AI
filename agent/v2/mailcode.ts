/**
 * Reads a one-time verification code or link from the user's inbox while an application is open
 * (e.g. Greenhouse's "enter the 8-character code we emailed you", or "verify your email" links).
 * Read-only IMAP with the user's Gmail app password; never sends, deletes or marks mail as read.
 */

export interface MailCreds {
  email: string;
  host: string;
  password: string;
}

/** Pulls the verification code out of an email body. */
export function extractCode(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  // Look shortly after words like "code"/"passcode" for a 4–10 character token with a digit,
  // or a mixed-case token (Greenhouse codes look like "aB3dE5fG").
  const re = /(code|passcode|pin|one[- ]time password|otp)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const window = t.slice(m.index + m[0].length, m.index + m[0].length + 220);
    const tokens = window.match(/\b[A-Za-z0-9]{4,10}\b/g) ?? [];
    const hit = tokens.find((w) => /\d/.test(w) && !/^(19|20)\d\d$/.test(w)) ?? tokens.find((w) => /[a-z]/.test(w) && /[A-Z]/.test(w) && w.length >= 6);
    if (hit) return hit;
  }
  return null;
}

/** Pulls a verify/confirm/activate link out of an email (HTML or text). */
export function extractLink(html: string, text = ""): string | null {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((x) => x[1].replace(/&amp;/g, "&"));
  const urls = [...hrefs, ...(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])];
  return urls.find((u) => /^https?:/.test(u) && /(verif|confirm|activat|validate|email-?token|registration)/i.test(u) && !/unsubscribe|privacy|help/i.test(u)) ?? null;
}

/**
 * Waits up to `timeoutMs` for an email that arrived after `since` and matches `match`
 * (tested against sender + subject), then returns its code or link.
 */
export async function waitForVerification(
  creds: MailCreds,
  opts: { since: Date; match: RegExp; want: "code" | "link"; timeoutMs?: number }
): Promise<string | null> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  const client = new ImapFlow({ host: creds.host || "imap.gmail.com", port: 993, secure: true, auth: { user: creds.email, pass: creds.password }, logger: false });
  await client.connect();
  try {
    while (Date.now() < deadline) {
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        // IMAP "since" is day-granular; filter by exact time below.
        const uids = ((await client.search({ since: new Date(opts.since.getTime() - 86400_000) }, { uid: true })) || []) as number[];
        for (const uid of uids.slice(-25).reverse()) {
          const msg = await client.fetchOne(String(uid), { envelope: true, source: { start: 0, maxLength: 200_000 } }, { uid: true });
          if (!msg) continue;
          const when = msg.envelope?.date ? new Date(msg.envelope.date) : null;
          if (when && when.getTime() < opts.since.getTime() - 60_000) continue;
          const from = (msg.envelope?.from ?? []).map((f) => `${f.name ?? ""} ${f.address ?? ""}`).join(" ");
          if (!opts.match.test(`${from} ${msg.envelope?.subject ?? ""}`)) continue;
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const text = `${msg.envelope?.subject ?? ""}\n${parsed.text ?? ""}`;
          const found = opts.want === "code" ? extractCode(text) : extractLink(typeof parsed.html === "string" ? parsed.html : "", parsed.text ?? "");
          if (found) return found;
        }
      } finally {
        lock.release();
      }
      await new Promise((r) => setTimeout(r, 6000));
    }
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Turns an IMAP error into something the user can act on. */
export function inboxErrorMessage(e: unknown): string {
  const err = e as { message?: string; responseText?: string; authenticationFailed?: boolean };
  const text = `${err.responseText ?? ""} ${err.message ?? ""}`;
  if (err.authenticationFailed || /invalid credentials|authenticat|AUTHENTICATIONFAILED|login/i.test(text))
    return "Gmail rejected the password. Use a 16-letter Gmail app password (myaccount.google.com/apppasswords), not your normal Gmail password.";
  if (/IMAP access is disabled|imap.*disabled/i.test(text)) return "IMAP is turned off for this Gmail account — turn it on in Gmail settings → Forwarding and POP/IMAP.";
  return (err.responseText || err.message || String(e)).slice(0, 200);
}
