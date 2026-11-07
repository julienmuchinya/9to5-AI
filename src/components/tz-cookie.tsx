"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Saves the browser's time zone in a cookie so server-rendered times show in the viewer's local time. */
export function TimeZoneCookie() {
  const router = useRouter();
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const current = document.cookie.match(/(?:^|; )tz=([^;]+)/)?.[1];
      if (tz && decodeURIComponent(current ?? "") !== tz) {
        document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }
    } catch {
      // no Intl support: keep the default zone
    }
  }, [router]);
  return null;
}
