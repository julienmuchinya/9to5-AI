import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { friendlyAuthError, safeNext } from "@/lib/site";

const OTP_TYPES = ["signup", "recovery", "invite", "magiclink", "email", "email_change"];

/**
 * Every link in a Supabase email lands here: sign-up confirmation, password reset,
 * email change, magic link. Handles all three formats Supabase can send:
 *   ?code=…                      (PKCE, default)
 *   ?token_hash=…&type=…         (custom email template — works on any device)
 *   #access_token=…              (implicit — the hash never reaches the server, so we hand off to /auth/complete)
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const type = q.get("type") ?? "";
  const isRecovery = type === "recovery";
  const next = isRecovery ? "/account?reset=1" : safeNext(q.get("next"), "/dashboard?welcome=1");
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  const fail = (msg: string) =>
    to(isRecovery ? `/forgot?expired=1&error=${encodeURIComponent(msg)}` : `/login?error=${encodeURIComponent(msg)}`);

  const err = q.get("error_description") ?? q.get("error");
  if (err) return fail(friendlyAuthError(err, q.get("error_code")));

  const code = q.get("code");
  const tokenHash = q.get("token_hash");
  if (!code && !tokenHash) {
    // Tokens may be in the #hash, which only the browser can read.
    return to(`/auth/complete?type=${encodeURIComponent(type)}&next=${encodeURIComponent(next)}`);
  }

  const supabase = await createServerSupabaseClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // PKCE links only work in the browser that asked for them.
      const msg = /verifier|code challenge/i.test(error.message)
        ? "Open the link in the same browser you used to request it — or type the 6-digit code instead."
        : friendlyAuthError(error.message, error.code);
      return fail(msg);
    }
  } else {
    const otpType = (OTP_TYPES.includes(type) ? type : "email") as EmailOtpType;
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: otpType });
    if (error) return fail(friendlyAuthError(error.message, error.code));
  }
  return to(next);
}
