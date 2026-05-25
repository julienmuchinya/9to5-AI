"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/constants";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/setup", label: "Setup" },
  { href: "/jobs", label: "Jobs" },
  { href: "/applications", label: "Applications" },
  { href: "/companies", label: "Companies" },
  { href: "/resumes", label: "Resume Library" },
  { href: "/cover-letters", label: "Cover Letters" },
  { href: "/evidence", label: "Evidence Bank" },
  { href: "/blocked", label: "Blocked Actions" },
  { href: "/limits", label: "Usage Limits" },
  { href: "/agent-logs", label: "Agent Logs" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-8">
        <Link href="/dashboard" className="text-lg font-bold text-[var(--accent)]">
          {APP_NAME}
        </Link>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Job agent dashboard</p>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
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
    </aside>
  );
}
