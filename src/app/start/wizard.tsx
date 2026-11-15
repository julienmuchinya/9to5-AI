"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveOnboarding } from "../desk-actions";
import { ResumeUpload } from "../profile/resume-upload";

const LEVELS: [string, string][] = [
  ["internship", "Internship"],
  ["new_grad", "New grad"],
  ["entry", "Entry level"],
  ["mid", "Mid level"],
  ["senior", "Senior"],
];
const PLACES: [string, string][] = [
  ["remote_us", "Remote (US)"],
  ["my_state", "In my state"],
  ["anywhere_us", "Anywhere in the US"],
];
const PAY: [string, string][] = [
  ["", "No minimum"],
  ["30000", "$30k+"],
  ["40000", "$40k+"],
  ["60000", "$60k+"],
  ["80000", "$80k+"],
  ["100000", "$100k+"],
];

const box = (on: boolean) =>
  `flex min-h-[48px] items-center justify-between gap-3 rounded-sm border px-4 text-left text-sm transition ${
    on ? "border-[var(--green)] bg-[var(--soft)] font-semibold" : "border-[var(--border-strong)] bg-[var(--sheet)] hover:border-[var(--foreground)]"
  }`;

/**
 * The setup wizard, shown full-screen over the desk. Step state is in the URL (?step=2) so the resume
 * upload's page refresh lands back on the same step.
 */
export function Wizard(props: {
  initialStep: 1 | 2 | 3;
  catalog: { field: string; roles: string[] }[];
  roles: string[];
  locations: string[];
  state: string;
  minSalary: number | null;
  relocation: boolean;
  levels: string[];
  resume: { has: boolean; parsed: boolean; updatedAt: string | null };
}) {
  const [step, setStepRaw] = useState(props.initialStep);
  const [roles, setRoles] = useState<string[]>(props.roles);
  const [custom, setCustom] = useState("");
  const [field, setField] = useState(props.catalog[0]?.field ?? "");
  const [places, setPlaces] = useState<string[]>(props.locations.filter((l) => PLACES.some(([v]) => v === l)).length ? props.locations : ["remote_us"]);
  const [state, setState] = useState(props.state);
  const [minpay, setMinpay] = useState(props.minSalary ? String(props.minSalary) : "");
  const [relocation, setRelocation] = useState(props.relocation);
  const [levels, setLevels] = useState<string[]>(props.levels);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setStep = (s: 1 | 2 | 3) => {
    setStepRaw(s);
    setErr(null);
    window.history.replaceState(null, "", `/start?step=${s}`);
    window.scrollTo(0, 0);
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const titles = ["What do you want\nto work on?", "What matters\nmost?", "One last thing.\nYour resume."];

  return (
    <div className="fixed inset-0 z-50 grid overflow-y-auto bg-[var(--paper)] md:grid-cols-[240px_1fr]">
      <aside className="flex flex-col bg-[#173d32] px-7 py-7 text-[#eef0e6] md:sticky md:top-0 md:h-screen">
        <p className="font-serif text-[32px] leading-none tracking-[-0.06em]">
          9to5<span className="text-[#e76a45]">.</span>
        </p>
        <div className="mt-6 md:mt-auto">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#f0b796]">A fresh start</p>
          <p className="display mt-3 text-[30px] text-[#f7f5ef]">
            Your desk.
            <br />
            Your rules.
          </p>
          <p className="mt-3 hidden text-sm text-[#cfd9d2] md:block">Three short steps. You can change any of this later.</p>
        </div>
        <p className="mt-10 hidden font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb3a8] md:block">0{step} / 03 · setting up</p>
      </aside>

      <main className="px-6 py-10 sm:px-12 md:py-16 lg:px-20">
        <div className="mx-auto max-w-[760px]">
          <div className="flex items-center justify-between gap-4">
            <p className="kicker rule-label">Setting up your workspace</p>
            <p className="kicker">Step {step} of 3</p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden>
            {[1, 2, 3].map((n) => (
              <span key={n} className={`h-[3px] ${n <= step ? "bg-[var(--orange)]" : "bg-[var(--line)]"}`} />
            ))}
          </div>

          <h1 className="display mt-10 whitespace-pre-line text-[40px] sm:text-[54px]">{titles[step - 1]}</h1>

          {step === 1 && (
            <>
              <p className="mt-3 text-sm text-[var(--muted)]">Pick a few roles in any field — the agent searches for exactly these. Add your own title if it isn’t listed.</p>
              <div className="no-scrollbar -mx-1 mt-8 flex gap-2 overflow-x-auto px-1 pb-1">
                {props.catalog.map((g) => (
                  <button
                    key={g.field}
                    type="button"
                    onClick={() => setField(g.field)}
                    aria-pressed={field === g.field}
                    className={`min-h-[40px] shrink-0 rounded-full border px-4 text-sm ${field === g.field ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--border-strong)] bg-[var(--sheet)]"}`}
                  >
                    {g.field}
                  </button>
                ))}
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {(props.catalog.find((g) => g.field === field)?.roles ?? []).map((r) => (
                  <button key={r} type="button" onClick={() => setRoles(toggle(roles, r))} aria-pressed={roles.includes(r)} className={box(roles.includes(r))}>
                    {r}
                    <span aria-hidden className="font-mono text-xs">
                      {roles.includes(r) ? "✓" : "+"}
                    </span>
                  </button>
                ))}
              </div>
              <form
                className="mt-5 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (custom.trim()) setRoles([...new Set([...roles, custom.trim()])]);
                  setCustom("");
                }}
              >
                <label htmlFor="custom-role" className="sr-only">
                  Another job title
                </label>
                <input id="custom-role" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Another title, e.g. Lab Technician" className="h-[48px] min-w-0 flex-1 rounded-sm border border-[var(--border-strong)] bg-[var(--sheet)] px-3.5 text-sm outline-none focus:border-[var(--green)]" />
                <button className="min-h-[48px] rounded-sm border border-[var(--border-strong)] px-4 text-sm font-semibold hover:border-[var(--foreground)]">Add</button>
              </form>
              {roles.length > 0 && (
                <div className="mt-6">
                  <p className="kicker">Your picks · {roles.length}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {roles.map((r) => (
                      <li key={r}>
                        <button type="button" onClick={() => setRoles(roles.filter((x) => x !== r))} className="min-h-[36px] rounded-full bg-[var(--soft)] px-3 text-sm" aria-label={`Remove ${r}`}>
                          {r} ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="mt-3 text-sm text-[var(--muted)]">Where you’d work, the level you’re at, and the pay floor. Roles outside these never reach your shortlist.</p>
              <fieldset className="mt-8">
                <legend className="kicker mb-3">Where</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PLACES.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setPlaces(toggle(places, v))} aria-pressed={places.includes(v)} className={box(places.includes(v))}>
                      {l}
                      <span aria-hidden className="font-mono text-xs">
                        {places.includes(v) ? "✓" : "+"}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="kicker">Your state {places.includes("my_state") ? "(needed)" : "(optional)"}</span>
                  <input value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} placeholder="TX" maxLength={2} className="mt-2 h-[48px] w-full rounded-sm border border-[var(--border-strong)] bg-[var(--sheet)] px-3.5 font-mono uppercase outline-none focus:border-[var(--green)]" />
                </label>
                <label className="block">
                  <span className="kicker">Minimum pay (optional)</span>
                  <select value={minpay} onChange={(e) => setMinpay(e.target.value)} className="mt-2 h-[48px] w-full rounded-sm border border-[var(--border-strong)] bg-[var(--sheet)] px-3 text-sm">
                    {PAY.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <fieldset className="mt-6">
                <legend className="kicker mb-3">Level</legend>
                <div className="flex flex-wrap gap-2">
                  {LEVELS.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setLevels(toggle(levels, v))} aria-pressed={levels.includes(v)} className={`min-h-[44px] rounded-full border px-4 text-sm ${levels.includes(v) ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--border-strong)] bg-[var(--sheet)]"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="mt-6 flex items-center justify-between gap-4 border-y border-[var(--border)] py-4">
                <span>
                  <span className="block font-semibold">Open to relocating</span>
                  <span className="block text-xs text-[var(--muted)]">Include on-site roles in other states.</span>
                </span>
                <input type="checkbox" checked={relocation} onChange={(e) => setRelocation(e.target.checked)} className="!h-5 !w-5" />
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <p className="mt-3 text-sm text-[var(--muted)]">Add a PDF and the agent reads your skills and experience to match roles. It never adds anything that isn’t on it.</p>
              <div className="mt-8 border border-dashed border-[var(--border-strong)] bg-[var(--sheet)] p-6 sm:p-8">
                <p className="display text-[24px]">{props.resume.has ? (props.resume.parsed ? "Your resume is on file." : "Your resume is saved, not read yet.") : "Choose a resume."}</p>
                <p className="mb-5 mt-1 text-sm text-[var(--muted)]">PDF, up to a few pages. You can add more versions later in the resume library.</p>
                <ResumeUpload hasResume={props.resume.has} hasParsed={props.resume.parsed} updatedAt={props.resume.updatedAt} />
              </div>
            </>
          )}

          {err && (
            <p role="alert" className="mt-6 border-l-[3px] border-red-400 px-3 py-2 text-sm text-red-400">
              {err}
            </p>
          )}

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6">
            {step === 1 ? (
              <Link href="/dashboard" className="min-h-[44px] content-center text-sm text-[var(--muted)] underline underline-offset-4">
                Skip setup
              </Link>
            ) : (
              <button type="button" onClick={() => setStep((step - 1) as 1 | 2)} className="min-h-[44px] text-sm font-semibold underline underline-offset-4">
                ← Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r =
                      step === 1
                        ? await saveOnboarding({ step: "roles", roles })
                        : await saveOnboarding({ step: "constraints", locations: places, state, minSalary: minpay ? Number(minpay) : null, relocation, levels });
                    if (r.ok) setStep((step + 1) as 2 | 3);
                    else setErr(r.message);
                  })
                }
                className="min-h-[44px] rounded-sm bg-[var(--green)] px-6 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Saving…" : "Continue →"}
              </button>
            ) : (
              <span className="flex flex-wrap items-center gap-4">
                {!props.resume.has && (
                  <Link href="/dashboard" className="min-h-[44px] content-center text-sm text-[var(--muted)] underline underline-offset-4">
                    I’ll add it later
                  </Link>
                )}
                <Link href="/dashboard" className="inline-flex min-h-[44px] items-center rounded-sm bg-[var(--orange)] px-6 text-sm font-semibold text-[#1b120d]">
                  Open my desk ↗
                </Link>
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
