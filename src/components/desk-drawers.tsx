"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Drawer } from "./drawer";
import { ThemeToggle } from "./theme";
import { getDeskData, getNotifications, setAgentRules, type DeskData, type DeskNotice } from "@/app/desk-actions";
import { createClient } from "@/lib/supabase/client";

/** Header shared by every drawer: orange overline, serif title, square close button. */
function DrawerHead({ over, title, onClose }: { over: string; title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 pb-5 pt-7 sm:px-10">
      <div>
        <p className="kicker !text-[var(--orange-text)]">{over}</p>
        <h2 className="display mt-2 text-[34px] sm:text-[38px]">{title}</h2>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-sm border border-[var(--border-strong)] text-lg hover:border-[var(--foreground)]">
        ×
      </button>
    </div>
  );
}

const field = (label: string, value: ReactNode) => (
  <div className="border-b border-[var(--border)] py-3">
    <dt className="kicker">{label}</dt>
    <dd className="mt-1 text-sm">{value || <span className="text-[var(--muted)]">Not set</span>}</dd>
  </div>
);

const yesNo = (v: boolean | null) => (v == null ? null : v ? "Yes" : "No");
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

export type DeskTab = "profile" | "resumes" | "preferences" | "agent" | "security";
const TABS: [DeskTab, string][] = [
  ["profile", "Profile"],
  ["resumes", "Resumes"],
  ["preferences", "Preferences"],
  ["agent", "Agent rules"],
  ["security", "Security"],
];

/** Profile & preferences: one drawer with five tabs, loaded when it opens. */
export function ProfileDrawer({ open, tab, onTab, onClose }: { open: boolean; tab: DeskTab; onTab: (t: DeskTab) => void; onClose: () => void }) {
  const [data, setData] = useState<DeskData | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    setFailed(false);
    getDeskData()
      .then(setData)
      .catch(() => setFailed(true));
  }, [open]);

  const agent = (patch: Parameters<typeof setAgentRules>[0]) =>
    start(async () => {
      const r = await setAgentRules(patch);
      setMsg(r.message);
      if (r.ok) setData(await getDeskData());
    });

  async function signOut() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <Drawer open={open} onClose={onClose} label="Profile and preferences" wide>
      <DrawerHead over="Candidate workspace" title="Behind the search." onClose={onClose} />
      <div className="px-6 sm:px-10">
        <div role="tablist" aria-label="Profile sections" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-[var(--border)] px-1">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => {
                onTab(k);
                setMsg(null);
              }}
              className={`-mb-px min-h-[44px] shrink-0 border-b-2 px-2.5 text-sm transition ${tab === k ? "border-[var(--orange)] font-semibold" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="py-7">
          {failed ? (
            <p className="text-sm text-red-400">Couldn’t load your profile. Close this and try again.</p>
          ) : !data ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse bg-[var(--hover)]" />
              ))}
            </div>
          ) : tab === "profile" ? (
            <>
              <div className="border border-[var(--border)] bg-[var(--card)] p-6">
                <p className="kicker">Candidate card / 001</p>
                <p className="display mt-3 text-[30px]">{data.profile.name || "Your name"}</p>
                {data.profile.headline && <p className="mt-1 text-sm text-[var(--muted)]">{data.profile.headline}</p>}
                <p className="kicker mt-5 border-t border-[var(--border)] pt-4">
                  {[data.profile.place, data.preferences.locations.join(" & ")].filter(Boolean).join(" · ") || "Location not set"}
                </p>
              </div>
              <dl className="mt-6">
                {field("Email on applications", data.profile.jobEmail ?? data.profile.email)}
                {field("Phone", data.profile.phone)}
                {field("Authorized to work in the US", yesNo(data.profile.workAuthorized))}
                {field("Needs visa sponsorship", yesNo(data.profile.sponsorship))}
              </dl>
              <p className="mt-6 border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
                The agent fills applications from these facts. It never makes up experience, degrees or work authorization.
              </p>
              <Link href="/profile" onClick={onClose} className="mt-6 inline-flex min-h-[44px] items-center bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
                Edit profile ↗
              </Link>
            </>
          ) : tab === "resumes" ? (
            <>
              <p className="display text-[26px]">Your story, on paper.</p>
              <p className="mt-1 text-sm text-[var(--muted)]">The agent picks the resume that fits each job best, and can lightly tailor it — never adding anything that isn’t true.</p>
              <ul className="mt-6 border-t border-[var(--foreground)]">
                {data.resumes.length === 0 && <li className="py-4 text-sm text-[var(--muted)]">No resume yet. Add one so the agent can match and apply.</li>}
                {data.resumes.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-4">
                    <div>
                      <p className="font-semibold">{r.label}</p>
                      <p className="text-xs text-[var(--muted)]">{r.uploaded ? `Uploaded ${shortDate(r.uploaded)}` : "Upload date unknown"}{!r.read ? " · not read yet" : ""}</p>
                    </div>
                    <span className="kicker">{r.id === "main" ? "Primary" : "Version"}</span>
                  </li>
                ))}
              </ul>
              <Link href="/resumes" onClick={onClose} className="mt-6 inline-flex min-h-[44px] items-center bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
                + Add or manage resumes
              </Link>
            </>
          ) : tab === "preferences" ? (
            <>
              <dl>
                {field("Roles you want", data.preferences.roles.join(", "))}
                {data.preferences.focus.length > 0 && field("Focus right now", data.preferences.focus.join(", "))}
                {field("Levels", data.preferences.levels.join(", ").replace(/_/g, " "))}
                {field("Where", data.preferences.locations.join(", "))}
                {field("Minimum pay", data.preferences.minSalary ? `$${Math.round(data.preferences.minSalary / 1000)}k / year` : null)}
                {field("Open to relocating", yesNo(data.preferences.relocation))}
                {field("Skills on file", data.preferences.skills ? `${data.preferences.skills} skills from your resume and profile` : null)}
              </dl>
              <Link href="/profile#roles" onClick={onClose} className="mt-6 inline-flex min-h-[44px] items-center bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
                Edit search preferences ↗
              </Link>
              <div className="mt-10">
                <p className="kicker mb-2">Appearance</p>
                <ThemeToggle />
              </div>
            </>
          ) : tab === "agent" ? (
            <>
              <p className="kicker !text-[var(--orange-text)]">Assisted search · your rules</p>
              <p className="display mt-2 text-[26px]">Smart help. Clear boundaries.</p>
              <p className="mt-1 text-sm text-[var(--muted)]">The agent looks for jobs about every hour. These rules decide what it may do on its own.</p>
              <ul className="mt-6 border-t border-[var(--foreground)]">
                <li className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-4">
                  <div>
                    <p className="font-semibold">Agent running</p>
                    <p className="text-xs text-[var(--muted)]">{data.agent.paused ? "Paused — it won’t look for jobs or apply." : "Looks for jobs and works through your queue."}</p>
                  </div>
                  <Switch on={!data.agent.paused} disabled={pending} label="Agent running" onChange={(v) => agent({ paused: !v })} />
                </li>
                <li className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-4">
                  <div>
                    <p className="font-semibold">Submit without asking</p>
                    <p className="text-xs text-[var(--muted)]">
                      {data.agent.autoSubmit ? "On — it applies to good matches by itself." : "Off — it only applies to jobs you queue yourself."}
                    </p>
                  </div>
                  <Switch on={data.agent.autoSubmit} disabled={pending} label="Submit without asking" onChange={(v) => agent({ autoSubmit: v })} />
                </li>
                <li className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-4">
                  <label htmlFor="daily-cap">
                    <span className="block font-semibold">Daily limit</span>
                    <span className="block text-xs text-[var(--muted)]">Most applications it sends in a day.</span>
                  </label>
                  <select
                    id="daily-cap"
                    value={String(data.agent.dailyCap)}
                    disabled={pending}
                    onChange={(e) => agent({ dailyCap: Number(e.target.value) })}
                    className="min-h-[40px] rounded-sm border border-[var(--border-strong)] bg-[var(--card)] px-2 text-sm"
                  >
                    {[...new Set([5, 10, 25, 50, 100, 200, data.agent.dailyCap])].sort((a, b) => a - b).map((n) => (
                      <option key={n} value={n}>
                        {n} a day
                      </option>
                    ))}
                  </select>
                </li>
              </ul>
              {msg && (
                <p role="status" className="mt-3 text-sm text-emerald-400">
                  {msg}
                </p>
              )}
              <p className="mt-6 border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
                Prepared isn’t submitted. An application only counts as sent when the agent saw the employer’s confirmation page or you marked it.
              </p>
              <Link href="/settings" onClick={onClose} className="mt-6 inline-flex min-h-[44px] items-center border border-[var(--border-strong)] px-4 text-sm font-semibold hover:border-[var(--foreground)]">
                All agent settings ↗
              </Link>
            </>
          ) : (
            <>
              <dl>
                {field("Sign-in email", data.security.email)}
                {field("Password recovery questions", data.security.hasQuestions ? "Set" : "Not set — set them so you can get back in")}
                {field("Inbox for tracking replies", data.security.inbox ?? "Not connected")}
                {field("Last sign-in", shortDate(data.security.lastSignIn))}
              </dl>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/account" onClick={onClose} className="inline-flex min-h-[44px] items-center bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
                  Password & recovery ↗
                </Link>
                <Link href="/accounts" onClick={onClose} className="inline-flex min-h-[44px] items-center border border-[var(--border-strong)] px-4 text-sm font-semibold hover:border-[var(--foreground)]">
                  Job-site logins ↗
                </Link>
              </div>
              <p className="mt-6 border-l-[3px] border-[var(--orange)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
                Portal passwords and inbox app passwords are stored encrypted. Recovery answers are stored one-way and can’t be read by anyone.
              </p>
              <button type="button" onClick={signOut} className="mt-8 min-h-[44px] text-sm font-semibold underline underline-offset-4">
                Sign out of this device
              </button>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}

const SEEN = "9to5:alerts-seen";
export function alertsSeenAt(): number {
  try {
    return Number(localStorage.getItem(SEEN) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Alerts: replies, things that need you, errors — each links to its record. */
export function NotificationsDrawer({ open, onClose, onSeen }: { open: boolean; onClose: () => void; onSeen: () => void }) {
  const [items, setItems] = useState<DeskNotice[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFailed(false);
    getNotifications()
      .then((r) => {
        setItems(r);
        try {
          localStorage.setItem(SEEN, String(Date.now()));
        } catch {
          /* private window */
        }
        onSeen();
      })
      .catch(() => setFailed(true));
  }, [open, onSeen]);
  const KIND = { needs: "Needs you", reply: "From your inbox", error: "Problem", submitted: "Agent" } as const;
  return (
    <Drawer open={open} onClose={onClose} label="Alerts">
      <DrawerHead over="New activity" title="A little update." onClose={onClose} />
      <div className="px-6 py-4 sm:px-10">
        {failed ? (
          <p className="text-sm text-red-400">Couldn’t load alerts. Close this and try again.</p>
        ) : !items ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse bg-[var(--hover)]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-sm text-[var(--muted)]">All quiet. Replies from employers, things that need you and problems show up here.</p>
        ) : (
          <ul>
            {items.map((n) => (
              <li key={n.id} className="border-b border-[var(--border)]">
                <Link href={n.href} onClick={onClose} className="flex items-start gap-3 py-4 hover:bg-[var(--hover)]">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.kind === "needs" ? "bg-amber-400" : n.kind === "error" ? "bg-red-400" : n.kind === "reply" ? "bg-[var(--orange)]" : "bg-[var(--accent-2)]"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="kicker block">
                      {KIND[n.kind]} · {new Date(n.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <span className="mt-0.5 block text-sm font-semibold">{n.title}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">{n.detail}</span>
                  </span>
                  <span aria-hidden>↗</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

/** "Good to know": what the labels and statuses mean. */
export function HelpDrawer({ open, onClose, onShortcuts }: { open: boolean; onClose: () => void; onShortcuts: () => void }) {
  const items: [string, string][] = [
    ["A fit label isn’t a promise.", "Strong fit, Good fit and Explore describe how much a posting overlaps your resume, roles, level and location. They don’t predict whether you’ll be hired."],
    ["Prepared isn’t submitted.", "A draft or queued application hasn’t gone anywhere. It counts as sent only after the employer’s confirmation page appeared, or you marked it yourself."],
    ["Submitted vs. confirmed.", "“Submitted · unconfirmed” means the agent saw a success page. “Confirmed received” means the employer’s confirmation reached your connected inbox."],
    ["Verified employers.", "Before applying, the agent checks the posting is on a real hiring system and the employer looks genuine. Unverified jobs are never applied to automatically."],
    ["You decide what it sends.", "With “Submit without asking” off, the agent only applies to jobs you queue. Pause it any time from Agent rules."],
    ["Your data.", "Your resume and profile are used only to find and fill in applications. Portal and inbox passwords are encrypted."],
  ];
  return (
    <Drawer open={open} onClose={onClose} label="Help">
      <DrawerHead over="How it works" title="Good to know." onClose={onClose} />
      <div className="px-6 py-4 sm:px-10">
        <ol>
          {items.map(([h, b], i) => (
            <li key={h} className="border-b border-[var(--border)] py-4">
              <p className="kicker">{String(i + 1).padStart(2, "0")}</p>
              <p className="mt-1 font-semibold">{h}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{b}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={onShortcuts} className="min-h-[44px] border border-[var(--border-strong)] px-4 text-sm font-semibold hover:border-[var(--foreground)]">
            Keyboard shortcuts
          </button>
          <Link href="/status" onClick={onClose} className="inline-flex min-h-[44px] items-center px-2 text-sm font-semibold underline underline-offset-4">
            System status ↗
          </Link>
        </div>
      </div>
    </Drawer>
  );
}

export const SHORTCUTS: [string, string][] = [
  ["Ctrl / ⌘ K", "Search any job"],
  ["/", "Search any job"],
  ["G then O", "Overview"],
  ["G then E", "Explore (search every job)"],
  ["G then M", "Your matches"],
  ["G then A", "Applications"],
  ["P", "Profile & preferences"],
  ["N", "Alerts"],
  ["?", "These shortcuts"],
  ["Esc", "Close a panel"],
];

export function ShortcutsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} label="Keyboard shortcuts">
      <DrawerHead over="Shortcuts" title="Quick ways around." onClose={onClose} />
      <dl className="px-6 py-4 sm:px-10">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3.5">
            <dt>
              <kbd className="rounded-sm border border-[var(--border-strong)] bg-[var(--card)] px-2 py-1 font-mono text-xs">{k}</kbd>
            </dt>
            <dd className="text-sm text-[var(--muted)]">{v}</dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}
