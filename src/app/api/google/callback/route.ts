import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { apiUser } from "@/lib/v2/session";
import { siteOrigin } from "@/lib/site";
import { GMAIL_OAUTH_HOST, exchangeGoogleCode } from "@/lib/v2/gmail";
import { encryptSecret } from "@/lib/v2/vault";

/** Google sends the user back here after "Connect with Google". */
export async function GET(req: NextRequest) {
  const origin = siteOrigin(await headers());
  const back = (msg: string) => {
    const res = NextResponse.redirect(`${origin}/settings?inbox=${encodeURIComponent(msg)}#inbox`);
    res.cookies.delete({ name: "g_oauth_state", path: "/api/google" });
    return res;
  };
  const auth = await apiUser();
  if (!auth) return NextResponse.redirect(`${origin}/login`);

  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "Google connection cancelled." : `Google said: ${q.get("error")}`);
  const state = req.cookies.get("g_oauth_state")?.value;
  if (!state || state !== q.get("state")) return back("That Google sign-in expired or didn't match. Click “Connect with Google” again.");
  const code = q.get("code");
  if (!code) return back("Google didn't send a code. Try again.");

  try {
    const { refreshToken, email, scope } = await exchangeGoogleCode(code, origin);
    if (!/gmail\.readonly/.test(scope)) return back("Please tick the box that lets 9to5 AI read your Gmail, then connect again.");
    const { error } = await auth.supabase
      .from("profiles")
      .upsert(
        { id: auth.user.id, inbox_email: email, inbox_host: GMAIL_OAUTH_HOST, inbox_password_enc: encryptSecret(refreshToken), inbox_error: null, inbox_last_scan_at: null },
        { onConflict: "id" }
      );
    if (error) return back(`Couldn’t save the connection: ${error.message}`);
    return back("ok");
  } catch (e) {
    return back((e as Error).message.slice(0, 250));
  }
}
