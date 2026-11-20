"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";

/**
 * Every search bar in the app: the text box, a Clear (×) button and a Search button.
 * Clear empties the box; when a search is showing, it also goes back to the page without it (`clearHref`).
 * Extra hidden fields (filters to keep) go in `children`.
 */
export function SearchBox({
  action,
  name = "q",
  defaultValue = "",
  placeholder = "Search jobs",
  clearHref,
  size = "lg",
  autoFocus,
  id,
  label = "Search jobs",
  inputRef,
  children,
}: {
  action: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  clearHref?: string;
  size?: "lg" | "sm";
  autoFocus?: boolean;
  id?: string;
  label?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  children?: ReactNode;
}) {
  const router = useRouter();
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const [value, setValue] = useState(defaultValue);
  const fieldId = id ?? `search-${name}`;
  const big = size === "lg";
  const clear = () => {
    setValue("");
    ref.current?.focus();
    if (defaultValue && clearHref) router.push(clearHref);
  };
  return (
    <form action={action} role="search" className={`flex items-stretch gap-2 ${big ? "max-w-[860px]" : ""}`}>
      {children}
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <div className="relative min-w-0 flex-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[var(--muted)] ${big ? "left-0 h-5 w-5" : "left-3 h-3.5 w-3.5"}`}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id={fieldId}
          ref={ref}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus={autoFocus}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          className={
            big
              ? "h-16 w-full border-0 border-b-2 border-[var(--foreground)] bg-transparent pl-9 pr-12 font-serif text-[22px] outline-none placeholder:text-[var(--muted)]/70 focus:border-[var(--orange)] sm:text-[28px]"
              : "h-10 w-full rounded-sm border border-[var(--border-strong)] bg-[var(--card)] pl-8 pr-9 text-sm outline-none transition focus:border-[var(--accent)]"
          }
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            title="Clear"
            className={`absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)] ${big ? "right-1 h-10 w-10 text-2xl" : "right-1 h-8 w-8 text-lg"}`}
          >
            ×
          </button>
        )}
      </div>
      <button
        type="submit"
        className={`shrink-0 bg-[var(--accent)] font-semibold text-white hover:bg-[var(--accent-hover)] ${big ? "min-h-[48px] self-end px-6 text-sm" : "h-10 rounded-sm px-3 text-xs"}`}
      >
        Search
      </button>
    </form>
  );
}
