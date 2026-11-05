"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { inputCls } from "@/components/security-questions";
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
  const newPasswordFields = (
    <>
      <label className="block text-sm">
        New password
        <input className={`${inputCls} mt-1`} type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" />
      </label>
      <label className="block text-sm">
        Repeat new password
        <input className={`${inputCls} mt-1`} type="password" minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" />
      </label>
      {pwMismatch && <p className="text-sm text-red-400">Passwords don’t match.</p>}
    </>
  );
  const btn = "w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--accent)]">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Reset your password</p>
        </div>
        {expired && step === "email" && <p className="text-sm text-amber-300">{expired}</p>}

        {step === "email" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setStep("choose");
            }}
          >
            <label className="block text-sm">
              Your account email
              <input className={`${inputCls} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} required autoComplete="email" />
              <span className="mt-1 block text-xs text-[var(--muted)]">Use the exact email you signed up with.</span>
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
              className="w-full rounded-lg bg-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
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
              <label key={q} className="block text-sm">
                {q}
                <input
                  className={`${inputCls} mt-1`}
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
            <label className="block text-sm">
              6-digit code from the email
              <input className={`${inputCls} mt-1 tracking-widest`} inputMode="numeric" pattern="[0-9]{6,8}" maxLength={8} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/D/g, ""))} required autoComplete="one-time-code" />
            </label>
            {newPasswordFields}
            <button disabled={busy || pwMismatch} className={btn}>
              {busy ? "Checking…" : "Reset password"}
            </button>
          </form>
        )}

        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.message}</p>}
        {step === "done" && (
          <Link href="/login" className={`${btn} block text-center`}>
            Go to sign in
          </Link>
        )}
        <Link href="/login" className="block text-center text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
