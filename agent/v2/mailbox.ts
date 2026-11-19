/**
 * One read-only way to look at the user's inbox, whichever way they connected it:
 * "Connect with Google" (Gmail API, OAuth refresh token) or an IMAP app password.
 */
import { decryptSecret } from "../../src/lib/v2/vault";
import { GMAIL_OAUTH_HOST, gmailAccessToken, gmailAfter, gmailRaw, gmailSearch } from "../../src/lib/v2/gmail";

export interface MailItem {
  id: string;
  from: string;
  subject: string;
  date: Date | null;
  /** Parsed body, fetched only when asked for. */
  body(): Promise<{ text: string; html: string }>;
}

export interface Mailbox {
  kind: "gmail-api" | "imap";
  /** Messages received since `since`, newest first, at most `max`. `hint` narrows a Gmail search (ignored by IMAP). */
  list(since: Date, max: number, hint?: string): Promise<MailItem[]>;
  /** One message by the id `list` gave it (null when it's gone). */
  get(id: string): Promise<{ from: string; subject: string; text: string } | null>;
  close(): Promise<void>;
}

export interface InboxCreds {
  inbox_email: string | null;
  inbox_host: string | null;
  inbox_password_enc: string | null;
}

export const isGoogleConnected = (u: InboxCreds) => u.inbox_host === GMAIL_OAUTH_HOST;

/** Readable text from an HTML email (many ATS emails have no plain-text part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function parse(raw: Buffer | string) {
  const { simpleParser } = await import("mailparser");
  const p = await simpleParser(raw);
  const html = typeof p.html === "string" ? p.html.slice(0, 200_000) : "";
  const text = (p.text && p.text.trim() ? p.text : htmlToText(html)).slice(0, 20_000);
  return { text, html };
}

export async function openMailbox(u: InboxCreds): Promise<Mailbox> {
  if (!u.inbox_email || !u.inbox_password_enc) throw new Error("No inbox connected");
  const secret = decryptSecret(u.inbox_password_enc);

  if (isGoogleConnected(u)) {
    const token = await gmailAccessToken(secret);
    return {
      kind: "gmail-api",
      async list(since, max, hint) {
        const found = await gmailSearch(token, `${gmailAfter(since)} -in:chats${hint ? ` ${hint}` : ""}`, max);
        return found.map((m) => ({ ...m, body: async () => parse(await gmailRaw(token, m.id)) }));
      },
      async get(id) {
        if (!/^[0-9a-f]{8,24}$/i.test(id)) return null;
        const raw = await gmailRaw(token, id).catch(() => null);
        if (!raw) return null;
        const { simpleParser } = await import("mailparser");
        const p = await simpleParser(raw);
        const { text } = await parse(raw);
        return { from: p.from?.text ?? "", subject: p.subject ?? "", text };
      },
      async close() {},
    };
  }

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({ host: u.inbox_host || "imap.gmail.com", port: 993, secure: true, auth: { user: u.inbox_email, pass: secret }, logger: false, connectionTimeout: 20_000 });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  return {
    kind: "imap",
    async list(since, max) {
      // IMAP "since" is whole days; filter to the exact time here.
      const uids = ((await client.search({ since: new Date(since.getTime() - 86400_000) }, { uid: true })) || []) as number[];
      const out: MailItem[] = [];
      for (const uid of uids.slice(-max).reverse()) {
        const msg = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
        if (!msg) continue;
        const date = msg.envelope?.date ? new Date(msg.envelope.date) : null;
        if (date && date.getTime() < since.getTime()) continue;
        out.push({
          id: msg.envelope?.messageId ?? `uid:${uid}`,
          from: (msg.envelope?.from ?? []).map((f) => `${f.name ?? ""} <${f.address ?? ""}>`).join(", "),
          subject: msg.envelope?.subject ?? "",
          date,
          body: async () => {
            const full = await client.fetchOne(String(uid), { source: { start: 0, maxLength: 200_000 } }, { uid: true });
            return full && full.source ? parse(full.source) : { text: "", html: "" };
          },
        });
      }
      return out;
    },
    async get(id) {
      if (!id.includes("@")) return null;
      const uids = ((await client.search({ header: { "message-id": id } }, { uid: true }).catch(() => [])) || []) as number[];
      if (!uids.length) return null;
      const full = await client.fetchOne(String(uids[0]), { source: { start: 0, maxLength: 200_000 } }, { uid: true });
      if (!full || !full.source) return null;
      const { simpleParser } = await import("mailparser");
      const p = await simpleParser(full.source);
      const { text } = await parse(full.source);
      return { from: p.from?.text ?? "", subject: p.subject ?? "", text };
    },
    async close() {
      lock.release();
      await client.logout().catch(() => client.close());
    },
  };
}
