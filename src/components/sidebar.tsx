"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { HelpDrawer, NotificationsDrawer, ProfileDrawer, ShortcutsDrawer, type DeskTab } from "./desk-drawers";

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
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  close: "M6 6l12 12M18 6L6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chevron: "M9 6l6 6-6 6",
  bookmark: "M7 4h10v16l-5-4-5 4z",
  check: "M5 12l4 4 10-10",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  calendar: "M5 6h14v14H5zM5 10h14M9 4v4M15 4v4",
  alert: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 8v5M12 16h.01",
  external: "M7 17L17 7M8 7h9v9",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01",
  signout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
};

export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

/** The three primary destinations. Everything else is a drawer or lives inside these. */
const NAV = [
  { n: "01", href: "/dashboard", label: "Your day", short: "Today", also: ["/chat"] },
  { n: "02", href: "/jobs", label: "Explore roles", short: "Explore", also: [] as string[] },
  { n: "03", href: "/applications", label: "Applications", short: "Applications", also: [] as string[] },
];

const TITLES: Record<string, string> = {
  "/dashboard": "Your day",
  "/jobs": "Explore roles",
  "/applications": "Applications",
  "/chat": "Chat with agent",
  "/profile": "Profile & job types",
  "/resumes": "Resume library",
  "/settings": "Agent settings",
  "/accounts": "Job-site logins",
  "/account": "Account & security",
  "/status": "System status",
  "/usage": "AI usage",
  "/start": "Set up your desk",
};

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/** Open a drawer from anywhere (e.g. "Manage rules" on Your day): window.dispatchEvent(new CustomEvent("desk:open", …)). */
export type DeskOpen = { drawer: "profile" | "alerts" | "help" | "shortcuts"; tab?: DeskTab };
export const openDesk = (d: DeskOpen) => window.dispatchEvent(new CustomEvent<DeskOpen>("desk:open", { detail: d }));

/** A button that opens one of the shell's drawers. */
export function DeskButton({ open, className = "", children }: { open: DeskOpen; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => openDesk(open)}>
      {children}
    </button>
  );
}

export function Wordmark({ light = false, size = "md" }: { light?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={`font-serif tracking-[-0.06em] ${size === "lg" ? "text-[40px]" : "text-[30px]"} leading-none ${light ? "text-[var(--rail-text)]" : ""}`}>
      9to5<span className="text-[var(--orange)]">.</span>
    </span>
  );
}

function initials(name: string, email: string) {
  return ((name.trim() || email)[0] ?? "?").toUpperCase();
}

/** App frame for signed-in pages: pine rail (desktop), top bar, 3-item bottom bar (mobile), and the drawers. */
export function AppShell({ email, name = "", needs = 0, today = "", children }: { email: string; name?: string; needs?: number; today?: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState<DeskOpen["drawer"] | null>(null);
  const [tab, setTab] = useState<DeskTab>("profile");
  const [seen, setSeen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const avatar = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setDrawer(null), []);
  const markSeen = useCallback(() => setSeen(true), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<DeskOpen>).detail;
      if (d.tab) setTab(d.tab);
      setDrawer(d.drawer);
    };
    window.addEventListener("desk:open", onOpen);
    return () => window.removeEventListener("desk:open", onOpen);
  }, []);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (search.current && search.current.offsetParent !== null) search.current.focus();
        else router.push("/jobs?focus=1");
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || drawer) return;
      const k = e.key.toLowerCase();
      if (g && Date.now() - g < 1200) {
        g = 0;
        const to = { d: "/dashboard", e: "/jobs", a: "/applications" }[k];
        if (to) {
          e.preventDefault();
          router.push(to);
        }
        return;
      }
      if (k === "g") g = Date.now();
      else if (k === "/") {
        e.preventDefault();
        if (search.current && search.current.offsetParent !== null) search.current.focus();
        else router.push("/jobs?focus=1");
      } else if (k === "?") setDrawer("shortcuts");
      else if (k === "p") setDrawer("profile");
      else if (k === "n") setDrawer("alerts");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, drawer]);

  const title = TITLES[Object.keys(TITLES).find((k) => isActive(pathname, k)) ?? ""] ?? "";
  const ini = initials(name, email);
  const quick = [
    { label: "Resume library", href: "/resumes" },
    { label: "Interviews", href: "/applications?tab=interview" },
    { label: "Chat with agent", href: "/chat" },
  ];

  return (
    <>
      {/* Desktop pine rail */}
      <aside className="sticky top-0 hidden h-screen w-[226px] shrink-0 flex-col bg-[var(--rail)] text-[var(--rail-text)] md:flex">
        <div className="border-b border-white/10 px-6 pb-7 pt-8">
          <Link href="/dashboard" aria-label="9to5 — Your day">
            <Wordmark light />
          </Link>
          <p className="kicker mt-3 !text-[var(--rail-muted)]">Your career desk</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-7">
          <p className="kicker mb-3 px-2 !text-[var(--rail-muted)]">Workspace / 01</p>
          <nav aria-label="Main" className="space-y-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href) || item.also.some((a) => isActive(pathname, a));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[44px] items-center gap-3 rounded-sm px-3 text-[15px] transition ${
                    active ? "bg-[var(--sheet)] font-semibold text-[var(--ink)]" : "text-[var(--rail-text)]/90 hover:bg-white/5"
                  }`}
                >
                  <span className={`font-mono text-xs ${active ? "text-[var(--ink)]/70" : "text-[var(--rail-muted)]"}`}>{item.n}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.href === "/applications" && needs > 0 && (
                    <span className={`font-mono text-[11px] ${active ? "text-[var(--orange-text)]" : "text-[var(--orange)]"}`} aria-label={`${needs} need you`}>
                      {String(needs).padStart(2, "0")}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="mx-2 my-7 border-t border-white/10" />
          <p className="kicker mb-2 px-2 !text-[var(--rail-muted)]">Quick access</p>
          <ul>
            {quick.map((q) => (
              <li key={q.href}>
                <Link href={q.href} className="flex min-h-[40px] items-center gap-3 rounded-sm px-3 text-sm text-[var(--rail-text)]/85 hover:bg-white/5">
                  <span className="text-[var(--rail-muted)]" aria-hidden>
                    ↳
                  </span>
                  {q.label}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => openDesk({ drawer: "profile", tab: "agent" })} className="flex min-h-[40px] w-full items-center gap-3 rounded-sm px-3 text-left text-sm text-[var(--rail-text)]/85 hover:bg-white/5">
                <span className="text-[var(--rail-muted)]" aria-hidden>
                  ↳
                </span>
                Agent rules
              </button>
            </li>
          </ul>
        </div>
        <div className="border-t border-white/10 px-5 py-5">
          <button type="button" onClick={() => openDesk({ drawer: "profile", tab: "profile" })} className="flex w-full items-center gap-3 rounded-sm p-1 text-left hover:bg-white/5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--cream)] font-serif text-lg text-[var(--ink)]">{ini}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{name || email.split("@")[0]}</span>
              <span className="block text-xs text-[var(--rail-muted)]">Candidate workspace ↗</span>
            </span>
          </button>
          <p className="kicker mt-4 flex justify-between !text-[10px] !text-[var(--rail-muted)]">
            <span>Private workspace</span>
            <span>V 03</span>
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-[66px] items-center gap-3 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 backdrop-blur md:h-[76px] md:px-10 lg:px-16">
          <Link href="/dashboard" className="md:hidden" aria-label="9to5 — Your day">
            <Wordmark />
          </Link>
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-6 md:flex">
            {today && <span className="kicker">{today}</span>}
            <span className="truncate text-sm">
              <span className="text-[var(--muted)]">/ </span>
              <span className="font-semibold" aria-current="page">
                {title}
              </span>
            </span>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <form action="/jobs" role="search" className="relative hidden lg:block">
              <label htmlFor="global-search" className="sr-only">
                Search roles
              </label>
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
              <input
                id="global-search"
                ref={search}
                name="q"
                placeholder="Search roles"
                className="h-10 w-56 rounded-sm border border-[var(--border-strong)] bg-[var(--card)] pl-8 pr-12 font-mono text-xs outline-none transition placeholder:text-[var(--foreground)] focus:w-72 focus:border-[var(--accent)]"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[var(--muted)]">⌘ K</kbd>
            </form>
            <Link href="/jobs?focus=1" className="grid h-11 w-11 place-items-center rounded-sm hover:bg-[var(--hover)] lg:hidden" aria-label="Search roles">
              <Icon name="search" className="h-5 w-5" />
            </Link>
            <button type="button" onClick={() => setDrawer("help")} className="hidden h-11 w-11 place-items-center rounded-sm hover:bg-[var(--hover)] sm:grid" aria-label="Help and how it works">
              <Icon name="help" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setDrawer("alerts")}
              className="relative grid h-11 w-11 place-items-center rounded-sm hover:bg-[var(--hover)]"
              aria-label={needs > 0 && !seen ? `Alerts — ${needs} application${needs === 1 ? "" : "s"} need you` : "Alerts"}
            >
              <Icon name="bell" className="h-5 w-5" />
              {needs > 0 && !seen && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-[var(--orange)]" aria-hidden />}
            </button>
            <button
              ref={avatar}
              type="button"
              onClick={() => {
                setTab("profile");
                setDrawer("profile");
              }}
              aria-haspopup="dialog"
              aria-expanded={drawer === "profile"}
              className="grid h-11 w-11 place-items-center rounded-sm hover:bg-[var(--hover)]"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] font-serif text-[15px] text-white">{ini}</span>
              <span className="sr-only">Open profile and preferences</span>
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-8 md:px-10 md:pb-16 md:pt-12 lg:px-16">
          <div className="mx-auto w-full max-w-[1180px]" id="content">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile: exactly the three destinations. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-[var(--border)] bg-[var(--background)] pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href) || item.also.some((a) => isActive(pathname, a));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-[13px] ${active ? "font-semibold" : "text-[var(--muted)]"}`}
            >
              {active && <span className="absolute inset-x-6 top-0 h-[2px] bg-[var(--orange)]" aria-hidden />}
              <span className="font-mono text-[10px]">{item.n}</span>
              {item.short}
              {item.href === "/applications" && needs > 0 && <span className="absolute right-[calc(50%-34px)] top-3 h-2 w-2 rounded-full bg-[var(--orange)]" aria-hidden />}
            </Link>
          );
        })}
      </nav>

      <ProfileDrawer open={drawer === "profile"} tab={tab} onTab={setTab} onClose={close} />
      <NotificationsDrawer open={drawer === "alerts"} onClose={close} onSeen={markSeen} />
      <HelpDrawer open={drawer === "help"} onClose={close} onShortcuts={() => setDrawer("shortcuts")} />
      <ShortcutsDrawer open={drawer === "shortcuts"} onClose={close} />
    </>
  );
}
