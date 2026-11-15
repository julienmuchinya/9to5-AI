"use client";

import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "9to5:theme";

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme.
 * Kept tiny and dependency-free; it must not throw (private windows block localStorage).
 */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("${KEY}")||"system";var d=c==="dark"||(c==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** System / Light / Dark segmented control. Saved per browser. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => setChoice(readChoice()), []);
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);

  function pick(c: ThemeChoice) {
    setChoice(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* not saved in private windows — still applies for this visit */
    }
    apply(c);
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--border)] bg-[var(--background-2)] p-1">
      {(["system", "light", "dark"] as const).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={choice === c}
          onClick={() => pick(c)}
          className={`min-h-[36px] rounded-lg px-2 text-sm capitalize transition ${
            choice === c ? "bg-[var(--card)] font-medium text-[var(--foreground)] shadow-[var(--shadow)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
