/**
 * Where links in emails should point. Uses the address the person is actually on
 * (so the live site never sends people to localhost), falling back to NEXT_PUBLIC_APP_URL.
 */
export function siteOrigin(h: Headers): string {
  const origin = h.get("origin");
  if (origin && /^https?:\/\//.test(origin)) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Only allow redirects to our own pages ("/dashboard"), never to other sites ("//evil.com"). */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Plain-English versions of Supabase auth errors. */
export function friendlyAuthError(message: string | null | undefined, code?: string | null): string {
  const m = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (/otp_expired|expired|invalid.*(token|link)|already been used/.test(m)) return "That link has expired or was already used. Links work once and only for 1 hour — request a new one.";
  if (/invalid login credentials/.test(m)) return "Wrong email or password. Check the email you signed up with, or use “Forgot password?”.";
  if (/email not confirmed/.test(m)) return "Your email isn’t confirmed yet. Click the link we emailed you, or resend it below.";
  if (/already registered|already exists/.test(m)) return "That email already has an account. Sign in, or use “Forgot password?”.";
  if (/rate|too many|seconds/.test(m)) return "Too many tries for now — the free email service only sends a few emails per hour. Wait a bit and try again.";
  if (/password/.test(m) && /(weak|short|least)/.test(m)) return "Password is too weak. Use 8+ characters with letters and numbers.";
  if (/access_denied/.test(m)) return "That link didn’t work. Request a new one.";
  return message || "Something went wrong. Please try again.";
}
