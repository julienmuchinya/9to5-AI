import type { Browser, Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiJson, FreeTierLimitError } from "../../src/lib/v2/gemini";
import { answerFromProfile, memoryKey, pickOption, type AppAnswers } from "../../src/lib/v2/app-questions";

export interface Applicant {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  website_url?: string | null;
  school?: string | null;
  graduation_date?: string | null;
  work_authorized_us?: boolean | null;
  sponsorship_needed?: boolean | null;
  relocation?: boolean | null;
  resume_text: string;
  /** Saved answers to common application questions (Profile → Common questions). */
  answers?: AppAnswers;
  /** Answers the AI gave before to the same (non job-specific) question. */
  memory?: AppAnswers;
  /** Login for this company's portal, used if the form asks to create an account. */
  portal?: { email: string; password: string } | null;
}

export type ApplyStatus = "submitted" | "needs_user" | "failed" | "closed";
export interface ApplyResult {
  status: ApplyStatus;
  detail: string;
  answers?: Record<string, string>;
  /** Question → answer pairs the AI produced, so they can be remembered. */
  learned?: { label: string; answer: string }[];
  /** True when the form had a password box and the portal login was used. */
  usedPortalLogin?: boolean;
  aiCalls?: number;
}

export interface Field {
  id: string;
  label: string;
  kind: "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "combobox";
  required: boolean;
  options: string[];
}

const SUCCESS = /thank you for (applying|your (application|interest))|application (has been |was )?(received|submitted)|we('|’)ve received your application|successfully submitted/i;
const CLOSED = /no longer (accepting|available|open)|job (is )?(closed|not found)|position has been filled|page (you('|’)re looking for )?(could not be|not) found/i;

function applyUrlFor(ats: string, url: string): string {
  if (ats === "lever" && !/\/apply\/?$/.test(url)) return url.replace(/\/?$/, "/apply");
  if (ats === "ashby" && !/\/application\/?$/.test(url)) return url.replace(/\/?$/, "/application");
  return url;
}

/** Tag every visible form control and describe it. */
async function collectFields(page: Page): Promise<Field[]> {
  return page.evaluate(() => {
    const out: Field[] = [];
    const seenRadio = new Set<string>();
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      return (r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none") || (el as HTMLInputElement).type === "file";
    };
    const labelFor = (el: Element): string => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const aria = el.getAttribute("aria-label");
      const labelledby = el.getAttribute("aria-labelledby");
      const lb = labelledby ? labelledby.split(/\s+/).map((x) => document.getElementById(x)?.textContent ?? "").join(" ") : "";
      const wrap = el.closest("label");
      const fieldset = el.closest("fieldset")?.querySelector("legend")?.textContent;
      const container = el.closest("[class*=field], [class*=question], .application-question, .form-group, li");
      const containerLabel = container?.querySelector("label, .application-label, [class*=label]")?.textContent;
      return (byFor?.textContent || aria || lb || wrap?.textContent || fieldset || containerLabel || el.getAttribute("placeholder") || el.getAttribute("name") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
    };
    let n = 0;
    const els = Array.from(document.querySelectorAll("input, textarea, select, [role=combobox]"));
    for (const el of els) {
      const input = el as HTMLInputElement;
      const type = (input.type || "").toLowerCase();
      if (["hidden", "submit", "button", "search", "image", "reset"].includes(type)) continue;
      if (!visible(el)) continue;
      if (el.closest("[aria-hidden=true]") && type !== "file") continue;
      const required = input.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(labelFor(el));
      if (type === "radio") {
        const name = input.name;
        if (seenRadio.has(name)) continue;
        seenRadio.add(name);
        const group = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`));
        const id = `f${n++}`;
        group.forEach((g, i) => g.setAttribute("data-9to5", `${id}_${i}`));
        const opts = group.map((g) => labelFor(g));
        const q = (el.closest("fieldset")?.querySelector("legend")?.textContent ?? el.closest("[class*=question], [class*=field]")?.querySelector("label, legend, [class*=label]")?.textContent ?? name).trim();
        out.push({ id, label: q.slice(0, 300), kind: "radio", required, options: opts });
        continue;
      }
      const id = `f${n++}`;
      el.setAttribute("data-9to5", id);
      if (el.tagName === "SELECT") {
        const opts = Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()).filter((t) => t && !/^select|^--/i.test(t));
        out.push({ id, label: labelFor(el), kind: "select", required, options: opts });
      } else if (el.getAttribute("role") === "combobox" && el.tagName !== "SELECT") {
        out.push({ id, label: labelFor(el), kind: "combobox", required, options: [] });
      } else if (type === "file") {
        out.push({ id, label: labelFor(el), kind: "file", required, options: [] });
      } else if (type === "checkbox") {
        out.push({ id, label: labelFor(el), kind: "checkbox", required, options: [] });
      } else {
        out.push({ id, label: labelFor(el), kind: el.tagName === "TEXTAREA" ? "textarea" : "text", required, options: [] });
      }
    }
    return out;
  });
}

const yesNo = (f: Field, yes: boolean): string => {
  if (!f.options.length) return yes ? "Yes" : "No";
  return pickOption(yes ? "Yes" : "No", f.options) ?? (yes ? "Yes" : "No");
};

/** Answers we know without asking the AI (free). */
export function knownValue(f: Field, a: Applicant): string | null {
  const l = f.label.toLowerCase();
  if (f.kind === "file") return /cover/.test(l) ? null : /resume|cv|attach/.test(l) || f.required ? "__RESUME__" : null;
  if (/password/.test(l)) return a.portal?.password ?? null;
  if (/first name|given name|preferred first|preferred name|nickname/.test(l)) return a.first_name;
  if (/last name|family name|surname/.test(l)) return a.last_name;
  if (/^(full )?name\b|your name|legal name/.test(l) && !/company|school|reference|employer/.test(l)) return `${a.first_name} ${a.last_name}`;
  if (/e-?mail/.test(l) && f.kind !== "checkbox" && f.kind !== "radio") return a.portal?.email && /account|login|user/.test(l) ? a.portal.email : a.email;
  // \b so "phonetic" or "mobile apps" don't count as a phone field.
  if (/\b(phone|mobile|cell)( number| no\.?)?\b(?! app)/.test(l) && !/phonetic/.test(l) && f.kind !== "radio" && f.kind !== "checkbox" && f.kind !== "select") return a.phone ?? null;
  if (/linkedin/.test(l)) return a.linkedin_url ?? null;
  if (/github/.test(l)) return a.github_url ?? null;
  if (/website|portfolio|personal (site|url)/.test(l)) return a.website_url ?? a.github_url ?? null;
  if ((/^(current )?(location|city)\b|where are you (located|based)/.test(l) || /city.{0,10}state/.test(l)) && f.kind !== "radio" && f.kind !== "checkbox")
    return [a.city, a.state].filter(Boolean).join(", ") || null;
  if (/^state\b|state of residence|province/.test(l) && f.kind !== "radio" && a.state) return f.options.length ? pickOption(a.state, f.options) : a.state;
  if (/^country\b|country of residence/.test(l) && f.kind !== "radio" && f.kind !== "checkbox") {
    const c = a.answers?.country || (a.state ? "United States" : "");
    if (c) return f.options.length ? (pickOption(c, f.options) ?? f.options.find((o) => /^(united states|usa|us)\b/i.test(o)) ?? null) : c;
  }
  if (/zip|postal/.test(l) && a.answers?.zip) return a.answers.zip;
  if (/(school|university|college|institution)/.test(l) && !/high school/.test(l) && (f.kind === "text" || f.kind === "combobox") && a.school) return a.school;
  if (/graduat/.test(l) && /date|year|when|expected/.test(l) && f.kind === "text" && a.graduation_date) return a.graduation_date;
  // Sponsorship before authorization: "authorized … without sponsorship" questions mention both.
  // Only real questions about NEEDING sponsorship — not notices like "sponsorship is not available, select Yes to confirm".
  const asksSponsorship = /(require|need|requiring|needing).{0,60}sponsor|sponsor.{0,40}(require|need)/.test(l) && !/not (available|allowed|offered|provided)|unable to (sponsor|offer)|confirm/.test(l);
  if (asksSponsorship && !/without (requiring )?(visa )?sponsor/.test(l) && a.sponsorship_needed != null) {
    const future = a.answers?.future_sponsorship;
    const needs = /future/.test(l) && future ? /^y/i.test(future) : a.sponsorship_needed;
    return yesNo(f, needs);
  }
  if (/(legally )?(authori[sz]ed|eligible|permitted) to work|work authori[sz]ation|right to work/.test(l) && a.work_authorized_us != null) {
    if (/without (requiring )?(visa )?sponsor/.test(l) && a.sponsorship_needed != null) return yesNo(f, a.work_authorized_us && !a.sponsorship_needed);
    return yesNo(f, a.work_authorized_us);
  }
  if (/relocat/.test(l) && !a.answers?.willing_to_relocate && a.relocation != null) return yesNo(f, a.relocation);
  const saved = answerFromProfile(f.label, f.options, a.answers ?? {});
  if (saved) return saved;
  const remembered = a.memory?.[memoryKey(f.label)];
  if (remembered) return f.options.length ? pickOption(remembered, f.options) : remembered;
  return null;
}

const captchaVisible = (page: Page) =>
  page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe"));
    return frames.some((f) => {
      const src = f.getAttribute("src") ?? "";
      const r = f.getBoundingClientRect();
      // Visible challenge widgets only; invisible reCAPTCHA v3 badges are fine.
      return /hcaptcha|recaptcha\/(api2|enterprise)\/(anchor|bframe)|challenges\.cloudflare|turnstile/.test(src) && r.width > 60 && r.height > 60 && !/size=invisible/.test(src);
    });
  });

async function fill(page: Page, f: Field, value: string, resumePath: string) {
  const sel = `[data-9to5="${f.id}"]`;
  switch (f.kind) {
    case "file":
      await page.setInputFiles(sel, resumePath);
      return;
    case "text":
    case "textarea":
      await page.fill(sel, value);
      return;
    case "select":
      await page.selectOption(sel, { label: value }).catch(async () => page.selectOption(sel, value));
      return;
    case "checkbox":
      if (/^(yes|true|checked|agree|1)$/i.test(value)) await page.check(sel).catch(() => page.click(sel));
      return;
    case "radio": {
      const i = f.options.findIndex((o) => o.toLowerCase() === value.toLowerCase());
      const idx = i >= 0 ? i : f.options.findIndex((o) => o.toLowerCase().startsWith(value.toLowerCase()));
      if (idx >= 0) await page.check(`[data-9to5="${f.id}_${idx}"]`).catch(() => page.click(`[data-9to5="${f.id}_${idx}"]`, { force: true }));
      return;
    }
    case "combobox":
      await page.click(sel);
      await page.fill(sel, value).catch(() => page.keyboard.type(value));
      await page.waitForTimeout(600);
      await page.keyboard.press("Enter");
      return;
  }
}

/** Hard limit for one application, so a slow or broken site can't hold up the whole run. */
const APPLY_TIMEOUT_MS = Number(process.env.APPLY_TIMEOUT_S ?? "180") * 1000;

/** Fill and (unless dryRun) submit one application. */
export async function applyToJob(
  browser: Browser,
  db: SupabaseClient,
  opts: { url: string; ats: string; applicant: Applicant; resumePath: string; jobTitle: string; company: string; userId: string; dryRun?: boolean }
): Promise<ApplyResult> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
    viewport: { width: 1280, height: 1600 },
  });
  // tsx/esbuild (keepNames) rewrites functions inside page.evaluate() to call a `__name` helper that
  // only exists in Node. Without this shim every form scan threw "__name is not defined" in the page.
  // Passed as a string so the bundler can't rewrite it too.
  await context.addInitScript("globalThis.__name = globalThis.__name || function (f) { return f; };");
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ApplyResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: "failed", detail: `Timed out after ${Math.round(APPLY_TIMEOUT_MS / 1000)}s — will retry next run` }),
      APPLY_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([fillAndSubmit(context, db, opts), timeout]);
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => {});
  }
}

async function fillAndSubmit(
  context: import("playwright").BrowserContext,
  db: SupabaseClient,
  opts: { url: string; ats: string; applicant: Applicant; resumePath: string; jobTitle: string; company: string; userId: string; dryRun?: boolean }
): Promise<ApplyResult> {
  const page = await context.newPage();
  // Default is 30s per action; a missing field would otherwise stall the run for minutes.
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(30000);
  let aiCalls = 0;
  try {
    const res = await page.goto(applyUrlFor(opts.ats, opts.url), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    const body = (await page.textContent("body").catch(() => "")) ?? "";
    if ((res && res.status() === 404) || CLOSED.test(body.slice(0, 4000))) return { status: "closed", detail: "Posting is closed" };

    // Greenhouse sometimes needs an "Apply" click to reveal the form.
    const applyBtn = page.locator("button:has-text('Apply'), a:has-text('Apply for this job')").first();
    if ((await page.locator("form input[type=file]").count()) === 0 && (await applyBtn.count()) > 0) {
      await applyBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    const fields = await collectFields(page);
    if (!fields.some((f) => f.kind === "file") && !fields.some((f) => /e-?mail/i.test(f.label)))
      return { status: "needs_user", detail: "Couldn't find the application form" };

    const answers: Record<string, string> = {};
    const unknown: Field[] = [];
    for (const f of fields) {
      const v = knownValue(f, opts.applicant);
      if (v) answers[f.id] = v;
      else unknown.push(f);
    }
    const usedPortalLogin = fields.some((f) => /password/i.test(f.label) && answers[f.id]);

    // Only pay for AI when a REQUIRED question is still blank; optional ones stay empty.
    const learned: { label: string; answer: string }[] = [];
    const needAi = unknown.filter((f) => f.required);
    if (needAi.length) {
      const facts = {
        name: `${opts.applicant.first_name} ${opts.applicant.last_name}`,
        location: [opts.applicant.city, opts.applicant.state].filter(Boolean).join(", "),
        school: opts.applicant.school,
        graduation: opts.applicant.graduation_date,
        authorized_to_work_in_us: opts.applicant.work_authorized_us,
        needs_visa_sponsorship: opts.applicant.sponsorship_needed,
        saved_answers: opts.applicant.answers ?? {},
        resume: opts.applicant.resume_text.slice(0, 6000),
      };
      try {
        aiCalls++;
        const ai = await geminiJson<Record<string, string | null>>(
          db,
          `You fill job application questions for ${facts.name}, applying to "${opts.jobTitle}" at ${opts.company}.
RULES:
- Use ONLY the facts below (saved_answers are the applicant's own answers to common questions). Never invent experience, numbers, dates, or skills.
- If a question can't be answered truthfully from the facts, return null for it.
- Voluntary demographic/EEO questions: use saved_answers if present, otherwise pick the "decline to self-identify"/"prefer not to say" option.
- Work authorization and sponsorship must match the facts exactly; if they are null, return null.
- For select/radio questions, return one of the listed options exactly.
- Checkbox: return "yes" only for required acknowledgements/consents to apply or privacy policies.
- Short free-text ("why this company", "cover letter") may be 2-4 honest sentences based on the resume.
FACTS: ${JSON.stringify(facts)}
QUESTIONS: ${JSON.stringify(needAi.map((f) => ({ id: f.id, question: f.label, type: f.kind, options: f.options, required: f.required })))}
Return JSON: {"<id>": "<answer or null>"}`,
          [],
          opts.userId
        );
        for (const f of needAi) {
          const v = ai[f.id];
          if (v != null && String(v).trim()) {
            answers[f.id] = String(v);
            if (f.kind !== "checkbox") learned.push({ label: f.label, answer: String(v) });
          }
        }
      } catch (e) {
        if (e instanceof FreeTierLimitError) return { status: "needs_user", detail: "AI quota used up today — finish this one yourself or it retries tomorrow", answers: labelled(fields, answers), aiCalls };
        throw e;
      }
    }

    const missing = fields.filter((f) => f.required && !answers[f.id]);
    if (missing.length)
      return { status: "needs_user", detail: `Needs your answer: ${missing.map((m) => m.label).slice(0, 5).join(" | ")} — add it under Profile → Common questions`, answers: labelled(fields, answers), learned, aiCalls };

    for (const f of fields) {
      const v = answers[f.id];
      if (!v) continue;
      await fill(page, f, v === "__RESUME__" ? "" : v, opts.resumePath).catch(() => {});
    }
    await page.waitForTimeout(1500);

    if (await captchaVisible(page)) return { status: "needs_user", detail: "Site shows a CAPTCHA — please submit this one yourself", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    if (opts.dryRun) return { status: "needs_user", detail: "Dry run: form filled but not submitted", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };

    const submit = page.locator("button[type=submit], input[type=submit], button:has-text('Submit application'), button:has-text('Submit')").last();
    if ((await submit.count()) === 0) return { status: "needs_user", detail: "Couldn't find the Submit button", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    await submit.click();
    await page.waitForTimeout(6000);

    const after = (await page.textContent("body").catch(() => "")) ?? "";
    if (SUCCESS.test(after) || /confirmation|thank/i.test(page.url())) return { status: "submitted", detail: "Application submitted", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    if (await captchaVisible(page)) return { status: "needs_user", detail: "CAPTCHA appeared on submit — please submit this one yourself", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    const err = after.match(/(this field is required|is required|please (enter|select|fill)[^.]{0,80}|invalid[^.]{0,60})/i)?.[0];
    return { status: "needs_user", detail: err ? `Form rejected: ${err}` : "Submitted but no confirmation seen — please check", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
  } catch (e) {
    return { status: "failed", detail: (e as Error).message.slice(0, 300), aiCalls };
  }
}

/** Answers keyed by the question text (what the user sees), not internal field ids. */
function labelled(fields: Field[], answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = answers[f.id];
    if (!v || f.kind === "file" || /password/i.test(f.label)) continue;
    out[f.label || f.id] = v;
  }
  return out;
}
