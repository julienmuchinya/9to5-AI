"use server";

import { headers } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { currentUser, serviceClient } from "@/lib/v2/session";
import { friendlyAuthError, siteOrigin } from "@/lib/site";
import { SECURITY_QUESTIONS, checkAnswer, decoyQuestions, hashAnswer } from "@/lib/v2/vault";

type Result = { ok: boolean; message: string };

const MAX_FAILURES_PER_DAY = 5;
const emailLc = (e: string) => e.trim().toLowerCase();
const strongEnough = (p: string) => p.length >= 8 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p);

async function failuresToday(email: string): Promise<number> {
  const { count } = await serviceClient()
    .from("password_reset_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email_lc", email)
    .eq("success", false)
    .gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  return count ?? 0;
}

async function logAttempt(email: string, method: string, success: boolean) {
  await serviceClient().from("password_reset_attempts").insert({ email_lc: email, method, success });
}

// ── Set up / change questions (signed in) ─────────────────────────────────
export async function saveSecurityQuestions(input: { q: string[]; a: string[] }): Promise<Result> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "Please sign in first." };
  const q = input.q.map((s) => s.trim());
  const a = input.a.map((s) => s.trim());
  if (q.length !== 3 || a.length !== 3) return { ok: false, message: "Pick three questions." };
  if (new Set(q).size !== 3 || q.some((x) => !SECURITY_QUESTIONS.includes(x))) return { ok: false, message: "Pick three different questions." };
  if (a.some((x) => x.replace(/[^a-z0-9]/gi, "").length < 2)) return { ok: false, message: "Each answer needs at least 2 letters or numbers." };
  const { error } = await serviceClient()
    .from("security_questions")
    .upsert({
      user_id: user.id,
      email_lc: emailLc(user.email),
      q1: q[0], a1_hash: hashAnswer(a[0]),
      q2: q[1], a2_hash: hashAnswer(a[1]),
      q3: q[2], a3_hash: hashAnswer(a[2]),
      updated_at: new Date().toISOString(),
    });
  return error ? { ok: false, message: error.message } : { ok: true, message: "Security questions saved." };
}

export async function hasSecurityQuestions(): Promise<boolean> {
  const { user } = await currentUser();
  if (!user) return false;
  const { data } = await serviceClient().from("security_questions").select("user_id").eq("user_id", user.id).maybeSingle();
  return Boolean(data);
}

// ── Recovery with questions ───────────────────────────────────────────────
export async function getRecoveryQuestions(email: string): Promise<{ questions: string[] }> {
  const e = emailLc(email);
  const { data } = await serviceClient().from("security_questions").select("q1,q2,q3").eq("email_lc", e).maybeSingle();
  // Unknown emails get stable decoy questions, so this can't reveal who has an account.
  return { questions: data ? [data.q1, data.q2, data.q3] : decoyQuestions(e) };
}

export async function resetWithAnswers(email: string, answers: string[], newPassword: string): Promise<Result> {
  const e = emailLc(email);
  if (!strongEnough(newPassword)) return { ok: false, message: "New password needs 8+ characters with letters and numbers." };
  if ((await failuresToday(e)) >= MAX_FAILURES_PER_DAY)
    return { ok: false, message: "Too many tries. For your safety, recovery is locked for 24 hours — or use the email code instead." };

  const { data } = await serviceClient().from("security_questions").select("*").eq("email_lc", e).maybeSingle();
  const allRight =
    Boolean(data) &&
    answers.length === 3 &&
    checkAnswer(answers[0], data!.a1_hash) &&
    checkAnswer(answers[1], data!.a2_hash) &&
    checkAnswer(answers[2], data!.a3_hash);
  if (!allRight) {
    await logAttempt(e, "questions", false);
    const left = MAX_FAILURES_PER_DAY - (await failuresToday(e));
    return { ok: false, message: `Those answers don't match. All three must be right. ${Math.max(0, left)} tries left today.` };
  }
  const { error } = await serviceClient().auth.admin.updateUserById(data!.user_id, { password: newPassword });
  if (error) return { ok: false, message: error.message };
  await logAttempt(e, "questions", true);
  return { ok: true, message: "Password changed. You can sign in now." };
}

// ── Recovery with an email code (free Supabase mailer) ────────────────────
export async function sendResetEmail(email: string): Promise<Result> {
  const e = emailLc(email);
  if ((await failuresToday(e)) >= MAX_FAILURES_PER_DAY) return { ok: false, message: "Too many tries. Try again in 24 hours." };
  const h = await headers();
  const origin = siteOrigin(h);
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: `${origin}/auth/callback?type=recovery` });
  if (error) return { ok: false, message: `${friendlyAuthError(error.message, error.code)} You can also use your security questions.` };
  // Same message whether or not the account exists.
  return {
    ok: true,
    message:
      "If that email has an account, we sent it a 6-digit code. Check inbox and spam. Nothing after 5 minutes? You may have signed up with a different email — try that one.",
  };
}

export async function resetWithCode(email: string, code: string, newPassword: string): Promise<Result> {
  const e = emailLc(email);
  if (!strongEnough(newPassword)) return { ok: false, message: "New password needs 8+ characters with letters and numbers." };
  if ((await failuresToday(e)) >= MAX_FAILURES_PER_DAY) return { ok: false, message: "Too many tries. Try again in 24 hours." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ email: e, token: code.trim(), type: "recovery" });
  if (error) {
    await logAttempt(e, "email", false);
    return { ok: false, message: "That code is wrong or expired. Codes last 1 hour and only the newest code works." };
  }
  const { error: upErr } = await supabase.auth.updateUser({ password: newPassword });
  if (upErr) return { ok: false, message: upErr.message };
  await logAttempt(e, "email", true);
  return { ok: true, message: "Password changed. You're signed in." };
}

/** Signed-in password change (also used after clicking the email link). */
export async function changePassword(newPassword: string): Promise<Result> {
  if (!strongEnough(newPassword)) return { ok: false, message: "Password needs 8+ characters with letters and numbers." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return error ? { ok: false, message: error.message } : { ok: true, message: "Password updated." };
}
