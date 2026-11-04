import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Landing page for the "reset password" email link. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const supabase = await createServerSupabaseClient();
  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })).error;
  url.search = "";
  url.pathname = ok ? "/account" : "/forgot";
  if (ok) url.searchParams.set("reset", "1");
  else url.searchParams.set("expired", "1");
  return NextResponse.redirect(url);
}
