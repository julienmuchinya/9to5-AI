"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthHeading, AuthShell, authButton, authInput, authLabel } from "@/components/auth-shell";
import { PasswordInput } from "@/components/password-input";
import { digitsOnly } from "@/lib/site";
import { getRecoveryQuestions, resetWithAnswers, resetWithCode, sendResetEmail } from "../auth-actions";

type Step = "email" | "choose" | "questions" | "code" | "done";

export default function ForgotPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState(["", "", ""]);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has("expired")) setExpired(p.get("error") || "That reset link expired or was already used. Start again below.");
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const pwMismatch = pw2.length > 0 && pw !== pw2;
  const pwWeak = pw.length > 0 && !(pw.length >= 8 && /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw));
  const newPasswordFields = (
    <>
      <label className={authLabel}>
        New password
        <PasswordInput className={authInput} minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" aria-describedby="pw-rules" />
        <span id="pw-rules" className={`mt-1.5 block font-sans text-xs normal-case tracking-normal ${pwWeak ? "text-amber-300" : "text-[var(--muted)]"}`}>
          8+ characters with at least one letter and one number.
        </span>
      </label>
      <label className={authLabel}>
        Repeat new password
        <PasswordInput className={authInput} minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" />
      </label>
      {pwMismatch && (
        <p role="alert" className="text-sm text-red-400">
          Passwords don’t match yet — the Reset button turns on when both fields are the same.
        </p>
      )}
    </>
  );
  const btn = authButton;

  return (
    <AuthShell statement="A little more *clarity.*" note="Locked out happens. Prove it’s you with a code sent to your email, or your three recovery answers.">
      <AuthHeading over="Account recovery" title="Find your way back." sub="We’ll help you get into your workspace. Nothing about your account is shown to anyone who doesn’t own it." />
      <div className="space-y-5">
        {expired && step === "email" && <p className="border-l-[3px] border-amber-400 px-3 py-2 text-sm text-amber-300">{expired}</p>}

        {step === "email" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setStep("choose");
            }}
          >
            <label className={authLabel}>
              Your account email
              <input className={`${authInput}`} type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} required autoComplete="email" />
              <span className="mt-1.5 block font-sans text-xs normal-case tracking-normal text-[var(--muted)]">Use the exact email you signed up with.</span>
            </label>
            <button className={btn}>Continue</button>
          </form>
        )}

        {step === "choose" && (
          <div className="space-y-3">
            <button
              disabled={busy}
              className={btn}
              onClick={() =>
                run(async () => {
                  const r = await sendResetEmail(email);
                  setMsg(r);
                  if (r.ok) setStep("code");
                })
              }
            >
              Email me a code
            </button>
            <button
              disabled={busy}
              className="flex h-[44px] w-full items-center justify-center rounded-sm border border-[var(--border-strong)] bg-[var(--sheet)] px-4 text-sm font-semibold hover:border-[var(--foreground)] disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  const r = await getRecoveryQuestions(email);
                  setQuestions(r.questions);
                  setStep("questions");
                })
              }
            >
              Answer my 3 security questions
            </button>
          </div>
        )}

        {step === "questions" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (pw !== pw2) return;
              run(async () => {
                const r = await resetWithAnswers(email, answers, pw);
                setMsg(r);
                if (r.ok) setStep("done");
              });
            }}
          >
            <p className="text-xs text-[var(--muted)]">All three answers must be right. Capitals and punctuation don’t matter.</p>
            {questions.map((q, i) => (
              <label key={q} className={`${authLabel} normal-case tracking-normal font-sans text-sm`}>
                {q}
                <input
                  className={`${authInput}`}
                  value={answers[i]}
                  autoComplete="off"
                  onChange={(e) => {
                    const a = [...answers];
                    a[i] = e.target.value;
                    setAnswers(a);
                  }}
                  required
                />
              </label>
            ))}
            {newPasswordFields}
            <button disabled={busy || pwMismatch} className={btn}>
              {busy ? "Checking…" : "Reset password"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (pw !== pw2) return;
              run(async () => {
                const r = await resetWithCode(email, code, pw);
                setMsg(r);
                if (r.ok) window.location.href = "/dashboard";
              });
            }}
          >
            <p className="text-xs text-[var(--muted)]">
              We emailed a 6-digit code to <b>{email}</b>. It works for 1 hour. Nothing after 5 minutes? Check spam, or{" "}
              <button type="button" className="underline" onClick={() => setStep("choose")}>
                go back
              </button>
              .
            </p>
            <label className={authLabel}>
              6-digit code from the email
              <input className={`${authInput} font-mono tracking-[0.4em]`} inputMode="numeric" pattern="[0-9]{6,8}" maxLength={8} placeholder="123456" value={code} onChange={(e) => setCode(digitsOnly(e.target.value))} required autoComplete="one-time-code" />
            </label>
            {newPasswordFields}
            <button disabled={busy || pwMismatch} className={btn}>
              {busy ? "Checking…" : "Reset password"}
            </button>
          </form>
        )}

        {msg && <p role={msg.ok ? "status" : "alert"} className={`border-l-[3px] px-3 py-2 text-sm ${msg.ok ? "border-emerald-400 text-emerald-400" : "border-red-400 text-red-400"}`}>{msg.message}</p>}
        {step === "done" && (
          <Link href="/login" className={`${btn} block text-center`}>
            Go to sign in
          </Link>
        )}
        <p className="pt-2 text-center text-sm">
          Remembered it?{" "}
          <Link href="/login" className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
