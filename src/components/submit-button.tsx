"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({ children, variant = "primary" }: { children: ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
      : "bg-[var(--border)] text-[var(--foreground)] hover:opacity-90";
  return (
    <button type="submit" disabled={pending} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${cls}`}>
      {pending ? "Saving…" : children}
    </button>
  );
}
