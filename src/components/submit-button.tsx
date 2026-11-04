"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Form button that shows "Saving…" while the save runs, then "Saved ✓" briefly. Failures go to the error screen. */
export function SubmitButton({ children, variant = "primary" }: { children: ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (was.current && !pending) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2500);
      was.current = pending;
      return () => clearTimeout(t);
    }
    was.current = pending;
  }, [pending]);
  const cls =
    variant === "primary"
      ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
      : "bg-[var(--border)] text-[var(--foreground)] hover:opacity-90";
  return (
    <button type="submit" disabled={pending} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${cls}`}>
      {pending ? "Saving…" : saved ? "Saved ✓" : children}
    </button>
  );
}
