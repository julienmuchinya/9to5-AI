import { NextResponse } from "next/server";
import { apiUser, serviceClient } from "@/lib/v2/session";
import { machineStatus } from "@/lib/v2/dispatch";
import { aiStatus } from "@/lib/v2/ai-status";

export const dynamic = "force-dynamic";

/** Live state for the Run button and status panels: is the agent machine running, last/next run, last counts. */
export async function GET() {
  const auth = await apiUser();
  if (!auth) return NextResponse.json({ error: "signed out" }, { status: 401 });
  const { supabase, user } = auth;
  const [machine, { data: runs }, ai] = await Promise.all([
    machineStatus(),
    supabase.from("agent_runs").select("started_at,ended_at,status,summary").eq("user_id", user.id).order("started_at", { ascending: false }).limit(1),
    aiStatus(serviceClient()),
  ]);
  return NextResponse.json({ machine, lastRun: runs?.[0] ?? null, ai: { mode: ai.mode, geminiResetsInH: ai.gemini.resetsInH } });
}
