"use client";

import { APP_NAME } from "@/lib/constants";

export function StatusBanners({
  mockMode,
  supabaseConnected,
  emergencyStop,
  autopilotOff,
  setupIncomplete,
  liveAgentBlocked,
}: {
  mockMode?: boolean;
  supabaseConnected?: boolean;
  emergencyStop?: boolean;
  autopilotOff?: boolean;
  setupIncomplete?: boolean;
  liveAgentBlocked?: boolean;
}) {
  const envMock =
    process.env.NEXT_PUBLIC_MOCK_MODE === "true" ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isMock = mockMode ?? envMock;

  const banners: { text: string; className: string }[] = [];

  if (isMock) {
    banners.push({
      text: `${APP_NAME} Mock Mode Active — no Supabase, Gmail, or Gemini calls`,
      className: "border-amber-800 bg-amber-950/50 text-amber-200",
    });
  } else {
    banners.push({
      text: `${APP_NAME} Live Mode Active`,
      className: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
    });
    if (supabaseConnected) {
      banners.push({
        text: "Supabase Connected",
        className: "border-emerald-800/60 bg-emerald-950/30 text-emerald-100",
      });
    } else {
      banners.push({
        text: "Supabase Missing — configure in Setup",
        className: "border-red-800 bg-red-950/40 text-red-200",
      });
    }
  }

  if (emergencyStop) {
    banners.push({
      text: "Emergency Stop Active — agent blocked",
      className: "border-red-800 bg-red-950/50 text-red-200",
    });
  }
  if (autopilotOff) {
    banners.push({
      text: "Autopilot Off",
      className: "border-slate-700 bg-slate-900/50 text-slate-300",
    });
  }
  if (setupIncomplete) {
    banners.push({
      text: "Setup Incomplete — finish checklist before live agent",
      className: "border-amber-800 bg-amber-950/40 text-amber-100",
    });
  }
  if (liveAgentBlocked) {
    banners.push({
      text: "Live Agent Blocked",
      className: "border-red-800 bg-red-950/40 text-red-200",
    });
  }
  banners.push({
    text: "Cost Limit $0 — Gemini calls blocked when budget risk detected",
    className: "border-slate-700 bg-slate-900/40 text-slate-400 text-xs",
  });

  return (
    <div className="space-y-0">
      {banners.map((b) => (
        <div
          key={b.text}
          className={`border-b px-4 py-2 text-center text-sm ${b.className}`}
        >
          {b.text}
        </div>
      ))}
    </div>
  );
}
