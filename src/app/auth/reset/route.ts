import { NextResponse, type NextRequest } from "next/server";

/** Old reset-link address — forwards to the shared email-link handler as a password reset. */
export function GET(request: NextRequest) {
  const url = new URL("/auth/callback", request.nextUrl.origin);
  request.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));
  url.searchParams.set("type", "recovery");
  return NextResponse.redirect(url);
}
