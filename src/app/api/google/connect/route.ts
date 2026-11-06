import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { apiUser } from "@/lib/v2/session";
import { siteOrigin } from "@/lib/site";
import { googleAuthUrl, googleOAuthConfigured } from "@/lib/v2/gmail";

/** Starts "Connect with Google": sends the user to Google's consent screen. */
export async function GET() {
  const origin = siteOrigin(await headers());
  const auth = await apiUser();
  if (!auth) return NextResponse.redirect(`${origin}/login`);
  if (!googleOAuthConfigured())
    return NextResponse.redirect(`${origin}/settings?inbox=${encodeURIComponent("Connect with Google isn't set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing in Vercel).")}#inbox`);
  const { data: p } = await auth.supabase.from("profiles").select("job_email").eq("id", auth.user.id).maybeSingle();
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(googleAuthUrl({ origin, state, loginHint: p?.job_email ?? auth.user.email }));
  // Checked on the way back so another site can't connect its own Gmail to this account.
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/api/google" });
  return res;
}
