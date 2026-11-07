/**
 * Clears the "Needs you" pile without asking the user: every question an application is waiting on is
 * answered by the AI with the best-chance-of-being-hired rules (answer-ai.ts), saved to the agent's
 * answer memory so it's never asked again, and the waiting applications go back in the queue.
 * Questions that only the user can answer (file/video uploads, a referrer's name) stay with the user.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiJson, FreeTierLimitError } from "../../src/lib/v2/gemini";
import { isJobSpecific, memoryKey, pickOption, type AppAnswers, type PendingQuestion } from "../../src/lib/v2/app-questions";
import { answerPrompt, salaryFacts } from "./answer-ai";

interface Waiting {
  id: string;
  pending_questions: PendingQuestion[] | null;
  jobs: { company_name: string; title: string } | null;
}

/** Only an upload or a named person can't be answered by the agent. */
export const needsHuman = (q: PendingQuestion) =>
  q.kind === "file" || /(video|upload|attach|record)\b.{0,40}(cover letter|answer|response|introduction)|\b(their|referrer'?s?) (name|email)|who referred you|name of (the )?(person|employee|referr)/i.test(q.label);

export async function answerWaitingQuestions(
  sb: SupabaseClient,
  userId: string,
  ctx: { name: string; facts: Record<string, unknown>; memory: AppAnswers; custom: AppAnswers; answers: AppAnswers },
  log: (m: string) => void,
  dryRun = false
): Promise<{ memory: AppAnswers; answered: number; requeued: number; aiCalls: number }> {
  const out = { memory: { ...ctx.memory }, answered: 0, requeued: 0, aiCalls: 0 };
  const { data } = await sb
    .from("applications")
    .select("id,pending_questions,jobs(company_name,title)")
    .eq("user_id", userId)
    .eq("status", "needs_user")
    .not("pending_questions", "is", null)
    .limit(300);
  const waiting = (data ?? []) as unknown as Waiting[];
  if (!waiting.length) return out;

  // Distinct generic questions (same wording = one question, whatever the company).
  const generic = new Map<string, PendingQuestion>();
  for (const w of waiting)
    for (const q of w.pending_questions ?? []) {
      if (needsHuman(q) || isJobSpecific(q.label, w.jobs?.company_name ?? "")) continue;
      const k = memoryKey(q.label);
      if (out.memory[k] || ctx.custom[k] || generic.has(k)) continue;
      generic.set(k, q);
    }

  const list = [...generic.entries()];
  // 15 per call keeps each prompt under Groq's 8,000 tokens/minute.
  for (let i = 0; i < list.length; i += 15) {
    const batch = list.slice(i, i + 15);
    try {
      out.aiCalls++;
      const ai = await geminiJson<Record<string, string | null>>(
        sb,
        answerPrompt({
          name: ctx.name,
          facts: { ...ctx.facts, saved_answers: ctx.answers, preferences: salaryFacts(ctx.answers, ctx.custom) },
          questions: batch.map(([k, q], n) => ({ id: `q${n}`, question: q.label, type: q.kind, options: (q.options ?? []).slice(0, 40), required: true })),
        }),
        [],
        userId,
        { prefer: "fallback", maxTokens: 2500 }
      );
      batch.forEach(([k, q], n) => {
        const v = ai[`q${n}`];
        if (v == null || !String(v).trim()) return;
        const fit = q.options?.length && q.kind !== "checkboxes" ? pickOption(String(v), q.options) : String(v);
        if (!fit) return;
        out.memory[k] = fit;
        out.answered++;
      });
    } catch (e) {
      if (e instanceof FreeTierLimitError) {
        log("  answering waiting questions: AI quota reached, the rest wait for tomorrow");
        break;
      }
      log(`  answering waiting questions failed: ${(e as Error).message.slice(0, 120)}`);
      break;
    }
  }

  // Everything except human-only questions can now be answered at apply time (generic from memory,
  // company-specific by the AI with the job description) → back in the queue.
  const ready = waiting.filter((w) => !(w.pending_questions ?? []).some(needsHuman)).map((w) => w.id);
  if (!dryRun && ready.length) {
    await sb
      .from("applications")
      .update({ status: "queued", pending_questions: null, attempts: 0, error: "The agent answered the waiting questions — reapplying" })
      .in("id", ready)
      .eq("user_id", userId);
    if (out.answered) await sb.from("profiles").update({ answer_memory: out.memory }).eq("id", userId);
  }
  out.requeued = ready.length;
  log(`  waiting questions: ${generic.size} distinct, ${out.answered} answered by AI (${out.aiCalls} call(s)), ${out.requeued} applications back in the queue`);
  return out;
}
