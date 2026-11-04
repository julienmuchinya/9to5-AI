"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { APP_NAME } from "@/lib/constants";
import { friendlyAuthError, safeNext } from "@/lib/site";

/** Finishes email links whose tokens arrive in the #hash (which the server can't see). */
export default function AuthCompletePage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const query = new URLSearchParams(window.location.search);
      const type = hash.get("type") ?? query.get("type") ?? "";
      const next = type === "recovery" ? "/account?reset=1" : safeNext(query.get("next"), "/dashboard?welcome=1");
      const err = hash.get("error_description") ?? hash.get("error");
      if (err) return setError(friendlyAuthError(err, hash.get("error_code")));

      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      const supabase = createClient();
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) return setError(friendlyAuthError(error.message, error.code));
        window.location.replace(next);
        return;
      }
      // Maybe already signed in (link opened twice).
      const { data } = await supabase.auth.getUser();
      if (data.user) return window.location.replace(next);
      setError("This link is missing its sign-in details. It may have been cut off by your email app — request a new one.");
    })();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 text-center">
        <h1 className="text-xl font-bold text-[var(--accent)]">{APP_NAME}</h1>
        {!error ? (
          <p className="text-sm text-[var(--muted)]">Signing you in…</p>
        ) : (
          <>
            <p className="text-sm text-red-400">{error}</p>
            <div className="flex flex-col gap-2">
              <Link href="/forgot" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
                Reset password
              </Link>
              <Link href="/login" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
