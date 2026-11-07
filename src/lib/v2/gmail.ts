/**
 * "Connect with Google": read-only Gmail access through Google's official OAuth + Gmail API.
 * No passwords: Google gives a refresh token, stored encrypted (profiles.inbox_password_enc,
 * with profiles.inbox_host = GMAIL_OAUTH_HOST to tell it apart from an IMAP app password).
 */

export const GMAIL_OAUTH_HOST = "gmail-oauth";
export const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"];

export const googleOAuthConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function googleRedirectUri(origin: string) {
  return process.env.GOOGLE_REDIRECT_URI || `${origin.replace(/\/$/, "")}/api/google/callback`;
}

export function googleAuthUrl(opts: { origin: string; state: string; loginHint?: string | null }) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(opts.origin),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline", // gives a refresh token so the agent can read mail on later runs
    prompt: "consent", // always return a refresh token, even on reconnect
    include_granted_scopes: "true",
    state: opts.state,
  });
  if (opts.loginHint) p.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...body }),
  });
  return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as TokenResponse;
}

/** Code from Google's redirect → refresh token + the Gmail address that was connected. */
export async function exchangeGoogleCode(code: string, origin: string): Promise<{ refreshToken: string; email: string; scope: string }> {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri(origin) });
  if (t.error || !t.access_token) throw new Error(t.error_description || t.error || "Google didn't return a token");
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token — remove 9to5 AI at myaccount.google.com/permissions and connect again");
  const payload = t.id_token ? JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString("utf8")) : {};
  return { refreshToken: t.refresh_token, email: String(payload.email ?? ""), scope: t.scope ?? "" };
}

export class GmailAuthError extends Error {}

/** Refresh token → short-lived access token. */
export async function gmailAccessToken(refreshToken: string): Promise<string> {
  const t = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  if (t.error === "invalid_grant") throw new GmailAuthError("Google access expired or was removed — click “Connect with Google” again on the Autopilot page.");
  if (t.error || !t.access_token) throw new Error(`Google token error: ${t.error_description || t.error}`);
  return t.access_token;
}

/** Gmail said "too many requests" (per-minute quota). Temporary — never a reason to disconnect. */
export class GmailRateLimitError extends Error {}

async function gmailGet<T>(token: string, path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new GmailAuthError("Google access expired — connect with Google again on the Autopilot page.");
    if (res.ok) return (await res.json()) as T;
    const body = await res.text();
    const limited = res.status === 429 || (res.status === 403 && /quota|rate ?limit|userRateLimitExceeded|rateLimitExceeded/i.test(body));
    if (limited && attempt < 4) {
      // Per-user quota is per minute: wait it out (2s, 4s, 8s, 16s).
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (limited) throw new GmailRateLimitError("Gmail is rate-limiting requests right now");
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 200)}`);
  }
}

export interface GmailHeaderInfo {
  id: string;
  from: string;
  subject: string;
  date: Date | null;
}

/** Messages matching a Gmail search (newest first), with sender/subject/date only. */
export async function gmailSearch(token: string, q: string, max = 100): Promise<GmailHeaderInfo[]> {
  const out: GmailHeaderInfo[] = [];
  let pageToken = "";
  while (out.length < max) {
    const list = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(
      token,
      `messages?${new URLSearchParams({ q, maxResults: String(Math.min(100, max - out.length)), ...(pageToken ? { pageToken } : {}) })}`
    );
    for (const m of list.messages ?? []) {
      const meta = await gmailGet<{ id: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } }>(
        token,
        `messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
      );
      const h = (n: string) => meta.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      out.push({ id: m.id, from: h("from"), subject: h("subject"), date: meta.internalDate ? new Date(Number(meta.internalDate)) : null });
    }
    if (!list.nextPageToken || !list.messages?.length) break;
    pageToken = list.nextPageToken;
  }
  return out;
}

/** Full message as raw RFC 822 bytes (parse with mailparser). */
export async function gmailRaw(token: string, id: string): Promise<Buffer> {
  const m = await gmailGet<{ raw: string }>(token, `messages/${id}?format=raw`);
  return Buffer.from(m.raw, "base64url");
}

/** Gmail search date: messages after this moment (Gmail accepts epoch seconds). */
export const gmailAfter = (d: Date) => `after:${Math.floor(d.getTime() / 1000)}`;
