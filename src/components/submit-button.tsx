"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buttonCls } from "./ui";

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
  return (
    <button type="submit" disabled={pending} className={buttonCls(variant)}>
      {pending ? "Saving…" : saved ? "Saved ✓" : children}
    </button>
  );
}
