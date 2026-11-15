"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { APP_NAME } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "./theme";
import { Drawer } from "./drawer";

const ICONS: Record<string, string> = {
  dashboard: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  overview: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  briefcase: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
  chat: "M4 5h16v10H8l-4 4V5z",
  jobs: "M4 7h16v12H4zM9 7V5h6v2",
  applications: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  accounts: "M7 11V8a5 5 0 0110 0v3M5 11h14v10H5zM12 15v2",
  profile: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  resumes: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7M9 8h3",
  usage: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  account: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  status: "M3 12h4l3-8 4 16 3-8h4",
  bell: "M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z",
  close: "M6 6l12 12M18 6L6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chevron: "M9 6l6 6-6 6",
  bookmark: "M7 4h10v16l-5-4-5 4z",
  check: "M5 12l4 4 10-10",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  calendar: "M5 6h14v14H5zM5 10h14M9 4v4M15 4v4",
  alert: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 8v5M12 16h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  signout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
};

export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

/** The three primary destinations. Everything else lives in the profile drawer or inside these screens. */
const NAV = [
  { href: "/dashboard", label: "Overview", icon: "overview", also: ["/chat"] },
  { href: "/jobs", label: "Find Jobs", icon: "search", also: [] as string[] },
  { href: "/applications", label: "Applications", icon: "briefcase", also: [] as string[] },
];

/** Former sidebar pages, now reached from the avatar drawer. Routes are unchanged. */
const DRAWER_LINKS = [
  { group: "You", items: [
    { href: "/profile", label: "Profile & job types", hint: "Contact details, roles you want, work authorization", icon: "profile" },
    { href: "/resumes", label: "Resumes", hint: "Your resume library and which one works best", icon: "resumes" },
  ] },
  { group: "Agent", items: [
    { href: "/chat", label: "Chat with agent", hint: "Ask for jobs, change settings in plain words", icon: "chat" },
    { href: "/settings", label: "Autopilot & settings", hint: "Auto-submit, daily limits, inbox, Gmail", icon: "settings" },
    { href: "/accounts", label: "Portal logins", hint: "Accounts the agent made on job sites", icon: "accounts" },
  ] },
  { group: "Account & system", items: [
    { href: "/account", label: "Account & security", hint: "Password and recovery questions", icon: "account" },
    { href: "/status", label: "System status", hint: "Agent runs, errors and logs", icon: "status" },
    { href: "/usage", label: "AI usage", hint: "Free-tier AI limits", icon: "usage" },
  ] },
];

const TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/jobs": "Find Jobs",
  "/applications": "Applications",
  "/chat": "Chat with agent",
  "/profile": "Profile & job types",
  "/resumes": "Resumes",
  "/settings": "Autopilot & settings",
  "/accounts": "Portal logins",
  "/account": "Account & security",
  "/status": "System status",
  "/usage": "AI usage",
};

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-white shadow-[0_6px_18px_-6px_var(--accent)]">
        <Icon name="sparkle" className="h-4 w-4" />
      </span>
      <span className="text-base font-bold tracking-tight">
        9to5 <span className="text-[var(--accent)]">AI</span>
      </span>
    </Link>
  );
}

function initials(name: string, email: string) {
  const src = name.trim() || email.split("@")[0] || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** App frame for signed-in pages: sidebar (desktop), top bar, bottom nav (mobile) and the profile drawer. */
export function AppShell({ email, name = "", needs = 0, children }: { email: string; name?: string; needs?: number; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const avatar = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setDrawer(false), []);

  // Ctrl/Cmd + K: jump to job search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (search.current && search.current.offsetParent !== null) search.current.focus();
        else router.push("/jobs?focus=1");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  async function signOut() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  const title = TITLES[Object.keys(TITLES).find((k) => isActive(pathname, k)) ?? ""] ?? "";
  const ini = initials(name, email);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)] px-4 py-6 md:flex">
        <div className="mb-8 px-2">
          <Logo />
        </div>
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Workspace</p>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href) || item.also.some((a) => isActive(pathname, a));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] transition ${
                  active ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon name={item.icon} className="h-[18px] w-[18px]" />
                <span className="flex-1">{item.label}</span>
                {item.href === "/applications" && needs > 0 && (
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300" aria-label={`${needs} need you`}>
                    {needs}
                  </span>
                )}
                {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--background-2)] p-4">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <Icon name="sparkle" />
              </span>
              <p className="text-sm font-semibold">Your AI agent</p>
            </div>
            <p className="text-xs leading-relaxed text-[var(--muted)]">Ask for jobs, pause the agent, or change what it applies to — in plain words.</p>
            <Link href="/chat" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-text)] hover:underline">
              Chat with agent <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-[66px] items-center gap-3 border-b border-[var(--border)] bg-[var(--card)]/85 px-4 backdrop-blur md:h-[76px] md:px-8">
          <div className="md:hidden">
            <Logo />
          </div>
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-sm md:flex">
            <span className="text-[var(--muted)]">9to5 AI</span>
            <Icon name="chevron" className="h-3.5 w-3.5 text-[var(--muted)]" />
            <span className="truncate font-semibold" aria-current="page">
              {title}
            </span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <form action="/jobs" role="search" className="relative hidden lg:block">
              <label htmlFor="global-search" className="sr-only">
                Search jobs and companies
              </label>
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                id="global-search"
                ref={search}
                name="q"
                placeholder="Search jobs and companies"
                className="h-10 w-72 rounded-xl border border-[var(--border)] bg-[var(--background-2)] pl-9 pr-14 text-sm outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">Ctrl K</kbd>
            </form>
            <Link href="/jobs?focus=1" className="grid h-11 w-11 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)] lg:hidden" aria-label="Search jobs">
              <Icon name="search" className="h-5 w-5" />
            </Link>
            <Link
              href="/applications?tab=needs"
              className="relative grid h-11 w-11 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
              aria-label={needs > 0 ? `${needs} application${needs === 1 ? "" : "s"} need you` : "Nothing needs you right now"}
            >
              <Icon name="bell" className="h-5 w-5" />
              {needs > 0 && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-[var(--card)]" aria-hidden />}
            </Link>
            <span className="mx-1 hidden h-8 w-px bg-[var(--border)] md:block" aria-hidden />
            <button
              type="button"
              ref={avatar}
              onClick={() => setDrawer(true)}
              aria-haspopup="dialog"
              aria-expanded={drawer}
              className="flex min-h-[44px] items-center gap-2 rounded-xl px-1.5 hover:bg-[var(--hover)] md:pr-3"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--foreground)] text-xs font-bold text-[var(--card)]">{ini}</span>
              <span className="hidden max-w-[10rem] truncate text-sm font-semibold md:block">{name || email.split("@")[0]}</span>
              <span className="sr-only">Open profile and preferences</span>
              <Icon name="chevron" className="hidden h-3.5 w-3.5 rotate-90 text-[var(--muted)] md:block" />
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-10">
          <div className="mx-auto w-full max-w-[1240px]" id="content">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation: exactly the three destinations. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-[var(--border)] bg-[var(--card)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href) || item.also.some((a) => isActive(pathname, a));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-xs ${active ? "font-semibold text-[var(--accent-text)]" : "text-[var(--muted)]"}`}
            >
              <Icon name={item.icon} className="h-5 w-5" />
              {item.label}
              {item.href === "/applications" && needs > 0 && <span className="absolute right-[calc(50%-22px)] top-2.5 h-2 w-2 rounded-full bg-amber-400" aria-hidden />}
            </Link>
          );
        })}
      </nav>

      <Drawer open={drawer} onClose={close} label="Profile and preferences" returnFocus={avatar}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-base font-semibold">Profile & preferences</h2>
          <button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]" aria-label="Close">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--foreground)] text-sm font-bold text-[var(--card)]">{ini}</span>
          <div className="min-w-0">
            {name && <p className="truncate font-semibold">{name}</p>}
            <p className="truncate text-sm text-[var(--muted)]" title={email}>
              {email}
            </p>
          </div>
        </div>
        <div className="space-y-6 px-5 pb-6">
          {DRAWER_LINKS.map((g) => (
            <section key={g.group}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{g.group}</h3>
              <ul className="overflow-hidden rounded-2xl border border-[var(--border)]">
                {g.items.map((it) => (
                  <li key={it.href} className="border-b border-[var(--border)] last:border-b-0">
                    <Link
                      href={it.href}
                      onClick={close}
                      aria-current={isActive(pathname, it.href) ? "page" : undefined}
                      className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--hover)]"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Icon name={it.icon} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{it.label}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">{it.hint}</span>
                      </span>
                      <Icon name="chevron" className="h-4 w-4 text-[var(--muted)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Appearance</h3>
            <ThemeToggle />
          </section>
          <button
            type="button"
            onClick={signOut}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
          >
            <Icon name="signout" /> Sign out
          </button>
        </div>
      </Drawer>
    </>
  );
}
