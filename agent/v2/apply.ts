import type { Browser, Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiJson } from "../../src/lib/v2/gemini";

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
  resume_text: string;
}

export type ApplyStatus = "submitted" | "needs_user" | "failed" | "closed";
export interface ApplyResult {
  status: ApplyStatus;
  detail: string;
  answers?: Record<string, string>;
}

interface Field {
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

/** Answers we know without asking the AI. */
function knownValue(f: Field, a: Applicant): string | null {
  const l = f.label.toLowerCase();
  if (f.kind === "file") return /cover/.test(l) ? null : /resume|cv|attach/.test(l) || f.required ? "__RESUME__" : null;
  if (/first name|given name|preferred first/.test(l)) return a.first_name;
  if (/last name|family name|surname/.test(l)) return a.last_name;
  if (/^(full )?name\b|your name|legal name/.test(l) && !/company|school|reference/.test(l)) return `${a.first_name} ${a.last_name}`;
  if (/e-?mail/.test(l) && !/confirm/.test(l)) return a.email;
  if (/confirm.*e-?mail/.test(l)) return a.email;
  if (/phone|mobile/.test(l)) return a.phone ?? null;
  if (/linkedin/.test(l)) return a.linkedin_url ?? null;
  if (/github/.test(l)) return a.github_url ?? null;
  if (/website|portfolio|personal (site|url)/.test(l)) return a.website_url ?? a.github_url ?? null;
  if (/^(current )?(location|city)\b|where are you (located|based)/.test(l) && f.kind !== "radio") return [a.city, a.state].filter(Boolean).join(", ") || null;
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
  const page = await context.newPage();
  try {
    const res = await page.goto(applyUrlFor(opts.ats, opts.url), { waitUntil: "domcontentloaded", timeout: 45000 });
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

    if (unknown.length) {
      const facts = {
        name: `${opts.applicant.first_name} ${opts.applicant.last_name}`,
        location: [opts.applicant.city, opts.applicant.state].filter(Boolean).join(", "),
        school: opts.applicant.school,
        graduation: opts.applicant.graduation_date,
        authorized_to_work_in_us: opts.applicant.work_authorized_us,
        needs_visa_sponsorship: opts.applicant.sponsorship_needed,
        resume: opts.applicant.resume_text.slice(0, 6000),
      };
      const ai = await geminiJson<Record<string, string | null>>(
        db,
        `You fill job application questions for ${facts.name}, applying to "${opts.jobTitle}" at ${opts.company}.
RULES:
- Use ONLY the facts below. Never invent experience, numbers, dates, or skills.
- If a question can't be answered truthfully from the facts, return null for it.
- Voluntary demographic/EEO questions (gender, race, veteran, disability): pick the "decline to self-identify"/"prefer not to say" option.
- Work authorization and sponsorship must match the facts exactly; if they are null, return null.
- For select/radio questions, return one of the listed options exactly.
- Checkbox: return "yes" only for required acknowledgements/consents to apply or privacy policies.
- Short free-text ("why this company", "cover letter") may be 2-4 honest sentences based on the resume.
FACTS: ${JSON.stringify(facts)}
QUESTIONS: ${JSON.stringify(unknown.map((f) => ({ id: f.id, question: f.label, type: f.kind, options: f.options, required: f.required })))}
Return JSON: {"<id>": "<answer or null>"}`,
        [],
        opts.userId
      );
      for (const f of unknown) {
        const v = ai[f.id];
        if (v != null && String(v).trim()) answers[f.id] = String(v);
      }
    }

    const missing = fields.filter((f) => f.required && !answers[f.id]);
    if (missing.length)
      return { status: "needs_user", detail: `Needs your answer: ${missing.map((m) => m.label).slice(0, 5).join(" | ")}`, answers };

    for (const f of fields) {
      const v = answers[f.id];
      if (!v) continue;
      await fill(page, f, v === "__RESUME__" ? "" : v, opts.resumePath).catch(() => {});
    }
    await page.waitForTimeout(1500);

    if (await captchaVisible(page)) return { status: "needs_user", detail: "Site shows a CAPTCHA — please submit this one yourself", answers };
    if (opts.dryRun) return { status: "needs_user", detail: "Dry run: form filled but not submitted", answers };

    const submit = page.locator("button[type=submit], input[type=submit], button:has-text('Submit application'), button:has-text('Submit')").last();
    if ((await submit.count()) === 0) return { status: "needs_user", detail: "Couldn't find the Submit button", answers };
    await submit.click();
    await page.waitForTimeout(6000);

    const after = (await page.textContent("body").catch(() => "")) ?? "";
    if (SUCCESS.test(after) || /confirmation|thank/i.test(page.url())) return { status: "submitted", detail: "Application submitted", answers };
    if (await captchaVisible(page)) return { status: "needs_user", detail: "CAPTCHA appeared on submit — please submit this one yourself", answers };
    const err = after.match(/(this field is required|is required|please (enter|select|fill)[^.]{0,80}|invalid[^.]{0,60})/i)?.[0];
    return { status: "needs_user", detail: err ? `Form rejected: ${err}` : "Submitted but no confirmation seen — please check", answers };
  } catch (e) {
    return { status: "failed", detail: (e as Error).message.slice(0, 300) };
  } finally {
    await context.close().catch(() => {});
  }
}
