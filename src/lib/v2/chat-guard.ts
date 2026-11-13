/** What the latest message must mention before a tool that changes something may run. */
const CHANGE_INTENT: Record<string, RegExp> = {
  set_autopilot: /\b(auto.?submit|cap|limit|per day|a day|daily|pause|resume|unpause|stop|turn (it )?(on|off)|enable|disable|fit|threshold|setting)/i,
  update_preferences: /\b(prefer|location|remote|role|salary|pay|keyword|exclude|level|intern|new grad|relocat|compan|city|state)/i,
  queue_applications: /\b(apply|queue|submit|send)/i,
  set_focus: /\b(focus|priorit|look for|search|find|apply|go after|target|instead|switch|clear|stop)/i,
  run_agent_now: /\b(run|start|go ahead|kick|launch|apply|search|look (for|into)|find|go after|hunt)\b/i,
  retry_applications: /\b(retry|re-?try|try again|re-?queue|requeue|back in(to)? the queue|reapply|re-?apply|again)/i,
  answer_question: /\b(answer|reply|respond|the answer is|say|tell (it|them|the agent)|put|fill)/i,
  update_applications: /\b(mark|applied|withdraw|withdrawn|reject|delete|remove|clear|got (an )?interview|interview|offer|rejected|cancel|drop)/i,
  dismiss_jobs: /\b(dismiss|hide|remove|not interested|skip|ignore|don.?t (want|show)|exclude|drop)/i,
};

/** null = allowed; otherwise why the change was not made. Exported for tests. */
export function changeNotAsked(tool: string, latest: string): string | null {
  const need = CHANGE_INTENT[tool];
  if (!need) return null;
  // A question ("why…?", "how many…") never changes anything unless it also asks for an action.
  const question = /\?\s*$/.test(latest.trim()) || /^\s*(why|what|how|is|are|does|do|did|when|where|which|who|can you explain|answer)\b/i.test(latest);
  const action =
    /\b(set|change|turn|raise|increase|lower|decrease|make|pause|resume|enable|disable|start|run|apply|queue|update|put|retry|requeue|mark|withdraw|delete|remove|dismiss|hide|answer|reply|skip|ignore|search|look for|find)\b/i.test(latest);
  if (question && !action) return "Not done: the user asked a question, not for a change. Answer it; offer the change if it would help.";
  if (need.test(latest)) return null;
  // A short reply to a question the agent just showed ("None", "Secret", "Yes, 2027") is an answer.
  if (tool === "answer_question" && latest.trim().length <= 60 && !question) return null;
  return "Not done: the user's latest message didn't ask for this change. Answer their question instead, or ask them to confirm the change.";
}
