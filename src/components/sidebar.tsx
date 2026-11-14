"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { APP_NAME } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

const ICONS: Record<string, string> = {
  dashboard: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  chat: "M4 5h16v10H8l-4 4V5z",
  jobs: "M4 7h16v12H4zM9 7V5h6v2",
  applications: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  accounts: "M7 11V8a5 5 0 0110 0v3M5 11h14v10H5zM12 15v2",
  profile: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 15H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 009 4V3a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1A1.6 1.6 0 0021 11h.1a2 2 0 110 4H21a1.6 1.6 0 00-1.6 0z",
  resumes: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7M9 8h3",
  usage: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  account: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  status: "M3 12h4l3-8 4 16 3-8h4",
};

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/chat", label: "Chat with agent", icon: "chat" },
  { href: "/jobs", label: "Matched jobs", icon: "jobs" },
  { href: "/applications", label: "Applications", icon: "applications" },
  { href: "/profile", label: "Profile & job types", icon: "profile" },
  { href: "/resumes", label: "Resumes", icon: "resumes" },
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/account", label: "Account & security", icon: "account" },
  // Portal logins live under Settings, free-tier usage under System status (pages still open by link).
  { href: "/status", label: "System status", icon: "status" },
];

export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-sm font-bold text-white shadow-[0_6px_18px_-6px_var(--accent)]">
        9
      </span>
      <span className="text-base font-semibold tracking-tight">{APP_NAME}</span>
    </Link>
  );
}

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
            className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
              active
                ? "bg-[var(--accent-soft)] font-medium text-[#c9c1ff] ring-1 ring-inset ring-[var(--accent)]/25"
                : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]"
            }`}
          >
            <Icon name={item.icon} className={`h-4 w-4 ${active ? "text-[var(--accent)]" : "opacity-70 group-hover:opacity-100"}`} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)]/85 px-4 py-3 backdrop-blur md:hidden">
        <Logo />
        <button onClick={() => setOpen(!open)} className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm" aria-expanded={open}>
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && <div className="border-b border-[var(--border)] bg-[var(--card)] p-3 md:hidden">{links}</div>}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]/60 p-4 backdrop-blur md:flex">
        <div className="mb-8 px-1">
          <Logo />
          <p className="mt-1.5 pl-[42px] text-xs text-[var(--muted)]">Your AI job agent</p>
        </div>
        {links}
        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--background-2)] p-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold uppercase text-[var(--accent)]">
              {email.slice(0, 1) || "?"}
            </span>
            <p className="min-w-0 truncate text-xs text-[var(--muted)]" title={email}>
              {email}
            </p>
          </div>
          <button onClick={signOut} className="mt-2 w-full rounded-lg px-2 py-1 text-left text-sm text-[var(--muted)] transition hover:bg-white/5 hover:text-[var(--foreground)]">
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
