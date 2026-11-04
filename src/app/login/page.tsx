"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { SecurityQuestionsFields, type QA } from "@/components/security-questions";
import { saveSecurityQuestions } from "../auth-actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [qa, setQa] = useState<QA>({ q: ["", "", ""], a: ["", "", ""] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

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
          options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        if (data.session) {
          const r = await saveSecurityQuestions(qa);
          if (!r.ok) throw new Error(`Account created, but security questions were not saved: ${r.message}. You can set them on the Account page.`);
        }
        if (!data.session) {
          setMsg({ kind: "info", text: "Account created. Check your email to confirm it, then sign in." });
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      window.location.href = "/dashboard";
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
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
          <input className={`${input} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
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
          <p className={`mb-4 text-sm ${msg.kind === "error" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</p>
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
          }}
          className="mt-4 w-full text-center text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
