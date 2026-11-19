"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Submit button that says what's happening while its form runs (and can't be clicked twice). */
export function PendingButton({ children, className, pending: busyLabel }: { children: ReactNode; className: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className} disabled:opacity-70`}>
      {pending ? busyLabel : children}
    </button>
  );
}
