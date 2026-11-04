"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { SecurityQuestionsFields, type QA } from "@/components/security-questions";
import { saveSecurityQuestions } from "../auth-actions";
import { friendlyAuthError, safeNext } from "@/lib/site";

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
  const [canResend, setCanResend] = useState(false);
  const [next, setNext] = useState("/dashboard");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setNext(safeNext(p.get("next")));
    const err = p.get("error");
    if (err) setMsg({ kind: "error", text: err });
    if (p.get("confirmed")) setMsg({ kind: "info", text: "Email confirmed — sign in below." });
  }, []);

  async function afterSignIn() {
    const pending = readPending();
    if (pending) {
      const r = await saveSecurityQuestions(pending);
      if (r.ok) writePending(null);
    }
    window.location.href = next;
  }

  async function resend() {
    setBusy(true);
    const { error } = await createClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?type=signup` },
    });
    setBusy(false);
    setMsg(error ? { kind: "error", text: friendlyAuthError(error.message, error.code) } : { kind: "info", text: "Sent. Check your inbox and spam folder." });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setCanResend(false);
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
          return afterSignIn();
        }
        writePending(qa); // saved automatically the first time they sign in
        setMode("signin");
        setCanResend(true);
        setMsg({ kind: "info", text: `Account created. We emailed a confirmation link to ${email} — click it, then sign in. Check spam if you don’t see it.` });
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed/i.test(error.message)) setCanResend(true);
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

  const input =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h1 className="text-xl font-bold text-[var(--accent)]">{APP_NAME}</h1>
        <p className="mb-6 mt-1 text-sm text-[var(--muted)]">
          {mode === "signin" ? "Sign in to your job agent" : "Create your account"}
        </p>
        {mode === "signup" && (
          <label className="mb-3 block text-sm">
            Full name
            <input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label className="mb-3 block text-sm">
          Email
          <input className={`${input} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} required autoComplete="email" />
        </label>
        <label className="mb-4 block text-sm">
          Password
          <input
            className={`${input} mt-1`}
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
          {mode === "signup" && <span className="mt-1 block text-xs text-[var(--muted)]">8+ characters with letters and numbers.</span>}
        </label>
        {mode === "signin" && (
          <Link href="/forgot" className="-mt-2 mb-4 block text-right text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
            Forgot password?
          </Link>
        )}
        {mode === "signup" && (
          <div className="mb-4">
            <p className="mb-2 text-sm font-medium">Security questions</p>
            <p className="mb-3 text-xs text-[var(--muted)]">If you forget your password, answering all three lets you reset it.</p>
            <SecurityQuestionsFields value={qa} onChange={setQa} />
          </div>
        )}
        {msg && (
          <p role="status" className={`mb-4 text-sm ${msg.kind === "error" ? "text-red-400" : "text-emerald-400"}`}>
            {msg.text}
          </p>
        )}
        {canResend && email && (
          <button type="button" onClick={resend} disabled={busy} className="mb-4 w-full rounded-lg bg-[var(--border)] px-4 py-2 text-sm disabled:opacity-50">
            Resend confirmation email
          </button>
        )}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setMsg(null);
            setCanResend(false);
          }}
          className="mt-4 w-full text-center text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
