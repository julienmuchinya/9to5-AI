/**
 * What a chat message plainly asks for, so the reply can be checked against what the model actually did:
 * a change it only talked about gets done, and a data question it answered from memory gets looked up.
 */

const QUESTION_ONLY = (l: string) => /\?\s*$/.test(l) || /^\s*(why|what|how|is|are|does|do|did|when|where|which|who)\b/i.test(l);

/** Changes the latest message clearly asks for → the tool that makes each one. */
export function expectedChanges(latest: string): string[] {
  const l = latest.trim();
  if (QUESTION_ONLY(l)) return [];
  const out: string[] = [];
  if (/\b(got|have|landed|received)\b.{0,20}\b(an? )?(interview|offer)\b|\b(mark|marked)\b.{0,40}\b(applied|rejected|withdrawn|interview|offer)\b|\bi (applied|withdrew)\b|\b(they|it) rejected\b|\bgot rejected\b/i.test(l)) out.push("update_applications");
  if (/\b(retry|re-?try|requeue|re-?queue|try again)\b/i.test(l)) out.push("retry_applications");
  if (/\b(dismiss|hide)\b.{0,40}\b(job|jobs|posting|role|roles)\b|\bnot interested in\b/i.test(l)) out.push("dismiss_jobs");
  return out;
}

/** Data questions that must be answered from a tool result, never from memory → the tool to call. */
export function expectedLookups(latest: string): string[] {
  const l = latest.trim().toLowerCase();
  if (!l || l.length < 4) return [];
  if (/\b(follow.?up|went quiet|no reply|heard (nothing|back)|ghosted|chase)\b/.test(l)) return ["follow_ups"];
  if (/\b(why)\b.{0,40}\b(few|low|not|no|so little|slow)\b.{0,60}\b(appl|submit|sent|going out)/.test(l) || /\bwhy (did|is|are|was|were)\b.{0,30}\b(fail|stop|stuck|blocked)/.test(l)) return ["explain_last_run"];
  if (/\b(match|missing|gap|coverage|how well)\b.{0,40}\b(resume|job|role|position|posting)\b|\bhow well do i (match|fit)\b/.test(l)) return ["job_match_report"];
  if (/\b(waiting on me|needs? (me|you)|pending|stuck|what did (you|the agent) (do|apply|submit)|which (ones|applications)|my applications|application status|what('s| is) (failed|queued))\b/.test(l)) return ["list_applications"];
  if (/\b(status|how many|summary|where (are we|do things stand)|progress)\b/.test(l)) return ["get_status"];
  if (/\b(show|find|list|any|new|fresh|best)\b.{0,30}\b(jobs?|matches|postings|roles)\b/.test(l)) return ["search_jobs"];
  return [];
}
