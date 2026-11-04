"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { APP_NAME } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chat", label: "Chat with agent" },
  { href: "/jobs", label: "Matched jobs" },
  { href: "/applications", label: "Applications" },
  { href: "/profile", label: "Resume & profile" },
  { href: "/settings", label: "Autopilot" },
  { href: "/usage", label: "Free-tier usage" },
];

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  const links = (
    <nav className="flex flex-1 flex-col gap-0.5">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`rounded-lg px-3 py-2 text-sm transition ${
              active
                ? "bg-[var(--accent)]/20 font-medium text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 md:hidden">
        <Link href="/dashboard" className="font-bold text-[var(--accent)]">
          {APP_NAME}
        </Link>
        <button onClick={() => setOpen(!open)} className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm">
          Menu
        </button>
      </div>
      {open && <div className="border-b border-[var(--border)] bg-[var(--card)] p-3 md:hidden">{links}</div>}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)] p-4 md:flex">
        <div className="mb-8">
          <Link href="/dashboard" className="text-lg font-bold text-[var(--accent)]">
            {APP_NAME}
          </Link>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Your AI job agent</p>
        </div>
        {links}
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <p className="truncate text-xs text-[var(--muted)]" title={email}>
            {email}
          </p>
          <button onClick={signOut} className="mt-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
