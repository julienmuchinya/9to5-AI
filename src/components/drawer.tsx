"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

/**
 * Accessible right-side drawer: focus moves in, Tab stays inside, Esc or the backdrop closes it,
 * and focus goes back to whatever opened it.
 */
export function Drawer({
  open,
  onClose,
  label,
  wide = false,
  modal = false,
  returnFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  wide?: boolean;
  /** Centered dialog instead of a right-side panel (focused decisions like "Prepare application"). */
  modal?: boolean;
  /** Element to focus on close. Defaults to whatever had focus when it opened (Safari doesn't focus clicked buttons). */
  returnFocus?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = returnFocus?.current ?? (document.activeElement as HTMLElement | null);
    const el = panel.current;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex='-1'])") ?? []).filter(
        (x) => x.offsetParent !== null
      );
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [open, onClose, returnFocus]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[#173d32]/45" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={
          modal
            ? "animate-fade-up absolute left-1/2 top-1/2 flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[780px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain border border-[var(--border)] bg-[var(--background)]"
            : `animate-slide-in absolute inset-y-0 right-0 flex w-full flex-col overflow-y-auto overscroll-contain border-l border-[var(--border)] bg-[var(--background)] ${wide ? "max-w-[720px]" : "max-w-[520px]"}`
        }
      >
        {children}
      </div>
    </div>
  );
}

/** A drawer whose open state lives in the URL (e.g. /applications?app=…), so it survives refresh and Back. */
export function RouteDrawer({ closeHref, label, children }: { closeHref: string; label: string; children: ReactNode }) {
  const router = useRouter();
  // Stable handler: an inline one would re-run the drawer's focus handling (and move focus) on every refresh.
  const close = useCallback(() => router.push(closeHref, { scroll: false }), [router, closeHref]);
  return (
    <Drawer open wide label={label} onClose={close}>
      {children}
    </Drawer>
  );
}
