"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { SecurityQuestionsFields, type QA } from "@/components/security-questions";
import { saveSecurityQuestions } from "../auth-actions";
import { digitsOnly, friendlyAuthError, safeNext } from "@/lib/site";
import { PasswordInput } from "@/components/password-input";
import { AuthHeading, AuthShell, authButton, authInput, authLabel } from "@/components/auth-shell";

const PENDING_QA = "9to5:pending-security-questions";

function readPending(): QA | null {
  try {
    const raw = localStorage.getItem(PENDING_QA);
    return raw ? (JSON.parse(raw) as QA) : null;
  } catch {
    return null;
  }
}
function writePending(qa: QA | null) {
  try {
    if (qa) localStorage.setItem(PENDING_QA, JSON.stringify(qa));
    else localStorage.removeItem(PENDING_QA);
  } catch {
    /* private window — the dashboard will remind them instead */
  }
}

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [qa, setQa] = useState<QA>({ q: ["", "", ""], a: ["", "", ""] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [next, setNext] = useState("/dashboard");
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setNext(safeNext(p.get("next")));
    if (p.get("mode") === "signup") setMode("signup");
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const err = p.get("error") ?? (hash.get("error") ? friendlyAuthError(hash.get("error_description"), hash.get("error_code")) : null);
    if (err) setMsg({ kind: "error", text: err });
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
    if (p.get("confirmed")) setMsg({ kind: "info", text: "Email confirmed — sign in below." });
  }, []);

  /** `to` overrides the destination — new accounts go to the three-step setup first. */
  async function afterSignIn(to?: string) {
    const pending = readPending();
    if (pending) {
      const r = await saveSecurityQuestions(pending);
      if (r.ok) writePending(null);
    }
    window.location.href = to ?? next;
  }

  async function resend() {
    setBusy(true);
    const { error } = await createClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?type=signup` },
    });
    setBusy(false);
    setMsg(error ? { kind: "error", text: friendlyAuthError(error.message, error.code) } : { kind: "info", text: `New code sent to ${email}. Check inbox and spam.` });
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.verifyOtp({ email, token: code.trim(), type: "signup" });
    if (error) {
      setBusy(false);
      setMsg({ kind: "error", text: /expired|invalid/i.test(error.message) ? "That code is wrong or expired. Codes last 1 hour — only the newest one works." : friendlyAuthError(error.message, error.code) });
      return;
    }
    // Confirming a sign-up code means a brand-new account: start with setup.
    await afterSignIn("/start");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/auth/callback?type=signup` },
        });
        if (error) throw error;
        // Supabase hides "already registered" by returning a user with no identities.
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          setMode("signin");
          setMsg({ kind: "error", text: "That email already has an account. Sign in, or use “Forgot password?”." });
          return;
        }
        if (data.session) {
          const r = await saveSecurityQuestions(qa);
          if (!r.ok) writePending(qa);
          return afterSignIn("/start");
        }
        writePending(qa); // saved automatically once they're signed in
        setVerifying(true);
        setMsg({ kind: "info", text: `Account created. We emailed a 6-digit code to ${email} — enter it below. Check spam if you don’t see it.` });
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed/i.test(error.message)) {
          setVerifying(true);
          setMsg({ kind: "error", text: "Your email isn’t confirmed yet. Enter the 6-digit code we emailed you, or send a new one." });
          return;
        }
        throw error;
      }
      await afterSignIn();
    } catch (err) {
      const e2 = err as { message?: string; code?: string };
      setMsg({ kind: "error", text: friendlyAuthError(e2.message, e2.code) });
    } finally {
      setBusy(false);
    }
  }

  if (verifying)
    return (
      <AuthShell statement="Almost *there.*" note="One quick check that this email is yours, and your desk is ready.">
        <AuthHeading over="Confirm your email" title="Check your inbox." sub={<>We sent a 6-digit code to <b className="text-[var(--foreground)]">{email}</b>. It works for one hour; check spam if it’s not there.</>} />
        <form onSubmit={verifyCode} className="space-y-5">
          <label className={authLabel}>
            6-digit code
            <input
              className={`${authInput} text-center font-mono text-xl tracking-[0.5em]`}
              inputMode="numeric"
              pattern="[0-9]{6,8}"
              maxLength={8}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(digitsOnly(e.target.value))}
              required
              autoFocus
              autoComplete="one-time-code"
            />
          </label>
          {msg && (
            <p role={msg.kind === "error" ? "alert" : "status"} className={`border-l-[3px] px-3 py-2 text-sm ${msg.kind === "error" ? "border-red-400 text-red-400" : "border-emerald-400 text-emerald-400"}`}>
              {msg.text}
            </p>
          )}
          <button disabled={busy || code.length < 6} className={authButton}>
            {busy ? "Checking…" : "Confirm and open my desk ↗"}
          </button>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <button type="button" onClick={resend} disabled={busy} className="min-h-[44px] font-semibold underline underline-offset-4 disabled:opacity-50">
              Send a new code
            </button>
            <button
              type="button"
              onClick={() => {
                setVerifying(false);
                setMode("signin");
                setMsg(null);
              }}
              className="min-h-[44px] text-[var(--muted)] underline underline-offset-4"
            >
              Back to sign in
            </button>
          </div>
        </form>
      </AuthShell>
    );

  const signup = mode === "signup";
  return (
    <AuthShell>
      <AuthHeading
        over={signup ? "Create your workspace" : "Welcome back"}
        title={signup ? "Start fresh." : <>Pick up where<br />you left off.</>}
        sub={signup ? "A place for your shortlist, applications and next steps — and an agent that works only within the rules you set." : "Your shortlist, applications, and next steps are right where you left them."}
      />
      <form onSubmit={submit} className="space-y-5">
        {signup && (
          <label className={authLabel}>
            Full name
            <input className={authInput} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="Your name" />
          </label>
        )}
        <label className={authLabel}>
          Email address
          <input className={authInput} type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} required autoComplete="email" placeholder="you@example.com" />
        </label>
        <label className={authLabel}>
          Password
          <PasswordInput
            className={authInput}
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="At least 8 characters"
            autoComplete={signup ? "new-password" : "current-password"}
          />
          {signup && <span className="mt-1.5 block font-sans text-xs normal-case tracking-normal text-[var(--muted)]">8+ characters with letters and numbers.</span>}
        </label>
        {signup && (
          <fieldset className="border-t border-[var(--border)] pt-5">
            <legend className={`${authLabel} mb-1`}>Recovery questions</legend>
            <p className="mb-3 text-xs text-[var(--muted)]">If you ever forget your password, answering all three — or a code sent to your email — gets you back in.</p>
            <SecurityQuestionsFields value={qa} onChange={setQa} />
          </fieldset>
        )}
        {signup && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" required className="mt-0.5" />
            <span>
              I understand 9to5 uses my resume and profile to find jobs and fill in applications, and only submits them within the rules I set.
            </span>
          </label>
        )}
        {msg && (
          <p role={msg.kind === "error" ? "alert" : "status"} className={`border-l-[3px] px-3 py-2 text-sm ${msg.kind === "error" ? "border-red-400 text-red-400" : "border-emerald-400 text-emerald-400"}`}>
            {msg.text}
          </p>
        )}
        <button disabled={busy} className={authButton}>
          {busy ? "Please wait…" : signup ? "Create account ↗" : "Sign in ↗"}
        </button>
      </form>
      <div className="mt-6 space-y-2 text-center text-sm">
        <p>
          {signup ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(signup ? "signin" : "signup");
              setMsg(null);
              setPassword(""); // don't carry a typed password between sign-in and sign-up
            }}
            className="min-h-[44px] font-semibold underline underline-offset-4"
          >
            {signup ? "Sign in" : "Create an account"}
          </button>
        </p>
        {!signup && (
          <Link href="/forgot" className="inline-flex min-h-[44px] items-center text-[var(--muted)] underline underline-offset-4">
            Forgot password?
          </Link>
        )}
      </div>
      <p className="mt-10 text-center text-xs text-[var(--muted)]">
        Your data stays private to your workspace ·{" "}
        <Link href="/" className="underline underline-offset-4">
          Back to welcome
        </Link>
      </p>
    </AuthShell>
  );
}
