/** What the latest message must mention before a tool that changes something may run. */
const CHANGE_INTENT: Record<string, RegExp> = {
  set_autopilot: /\b(auto.?submit|cap|limit|per day|a day|daily|pause|resume|unpause|stop|turn (it )?(on|off)|enable|disable|fit|threshold|setting)/i,
  update_preferences: /\b(prefer|location|remote|role|salary|pay|keyword|exclude|level|intern|new grad|relocat|compan|city|state)/i,
  queue_applications: /\b(apply|queue|submit|send)/i,
  run_agent_now: /\b(run|start|go ahead|kick|launch|apply now)/i,
};

/** null = allowed; otherwise why the change was not made. Exported for tests. */
export function changeNotAsked(tool: string, latest: string): string | null {
  const need = CHANGE_INTENT[tool];
  if (!need) return null;
  // A question ("why…?", "how many…") never changes anything unless it also asks for an action.
  const question = /\?\s*$/.test(latest.trim()) || /^\s*(why|what|how|is|are|does|do|did|when|where|which|who|can you explain|answer)\b/i.test(latest);
  const action = /\b(set|change|turn|raise|increase|lower|decrease|make|pause|resume|enable|disable|start|run|apply|queue|update|put)\b/i.test(latest);
  if (question && !action) return "Not done: the user asked a question, not for a change. Answer it; offer the change if it would help.";
  if (need.test(latest)) return null;
  return "Not done: the user's latest message didn't ask for this change. Answer their question instead, or ask them to confirm the change.";
}
