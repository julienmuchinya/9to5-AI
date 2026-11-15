"use client";

import { useState, type InputHTMLAttributes } from "react";

/** Password field with an accessible Show/Hide toggle. The value never leaves the input. */
export function PasswordInput({ className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative mt-1 block">
      <input {...props} type={show ? "text" : "password"} className={`${className} pr-16`} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute bottom-0 right-0 top-auto h-[50px] min-w-[44px] px-3 font-sans text-xs normal-case tracking-normal text-[var(--foreground)] underline underline-offset-2 hover:text-[var(--orange-text)]"
      >
        {show ? "Hide" : "Show"}
      </button>
    </span>
  );
}
