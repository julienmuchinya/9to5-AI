import type { Browser, Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiJson, FreeTierLimitError } from "../../src/lib/v2/gemini";
import { applyWorkday } from "./workday";
import { answerPrompt, salaryFacts } from "./answer-ai";
import { answerFromProfile, commonSenseAnswer, findSimilarAnswer, memoryKey, pickOption, questionFor, type AppAnswers, type PendingQuestion } from "../../src/lib/v2/app-questions";

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
  /** Jobs from the parsed resume (most recent first) — for work-history dates on portals like Workday. */
  experience?: { title: string; company: string; start?: string | null; end?: string | null }[];
  /** GPA exactly as on the resume, if it lists one. */
  gpa?: string | null;
  /** Schools from the parsed resume (most recent first). */
  education?: { school?: string | null; degree?: string | null; field?: string | null; graduation?: string | null }[];
  /** Saved answers to common application questions (Profile → Common questions). */
  answers?: AppAnswers;
  /** Answers the AI gave before to the same (non job-specific) question. */
  memory?: AppAnswers;
  /** The user's own answers to questions the agent asked them before (memoryKey → answer). */
  custom?: AppAnswers;
  /** Login for this company's portal, used if the form asks to create an account. */
  portal?: { email: string; password: string } | null;
}

export interface ApplyOpts {
  url: string;
  ats: string;
  applicant: Applicant;
  resumePath: string;
  jobTitle: string;
  company: string;
  userId: string;
  dryRun?: boolean;
  jobDescription?: string;
  /** Reads a one-time code a site emailed during the application. */
  emailCode?: (since: Date) => Promise<string | null>;
  /** Reads a "verify your account" link a site emailed (Workday account creation). */
  /** `host`: the portal the link should point at (e.g. acme.wd5.myworkdayjobs.com). */
  emailLink?: (since: Date, match: RegExp, host?: string) => Promise<string | null>;
  /** True when this portal account was already created on an earlier run. */
  accountExists?: boolean;
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
  /** Required questions with no answer — shown to the user to answer once. */
  pending?: PendingQuestion[];
  /** A portal account was created (or confirmed working) during this attempt. */
  accountCreated?: boolean;
}

export interface Field {
  id: string;
  label: string;
  kind: "text" | "textarea" | "select" | "radio" | "checkbox" | "checkboxes" | "file" | "combobox";
  required: boolean;
  options: string[];
  /** The control already has a value (pre-filled by the site). */
  filled?: boolean;
}

const STAND_OUT = /(why (do you|are you|this|our|us)|cover letter|anything else|additional (information|comments)|tell us|what (excites|interests)|interest(ed)? in)/i;
/** Confirmation wording across ATSs ("Thank you for applying", Ashby "Thanks so much for applying", Lever "Thanks for applying!"…). */
export const SUCCESS =
  /thank(s| you)( so much| very much)? for (applying|your (application|submission)|submitting)|application (has been |was )?(successfully )?(received|submitted|sent)|we('|’)ve (successfully )?received your application|we have (successfully )?received your application|successfully (submitted|applied)|application submitted|congratulations[^.]{0,40}(submitted|applied)|you('|’)ve (successfully )?applied|your application is (in|complete)/i;
const CLOSED = /no longer (accepting|available|open)|job (is )?(closed|not found)|position has been filled|page (you('|’)re looking for )?(could not be|not) found/i;

/** The page with the form: Lever "…/apply", Ashby "…/application" — added to the PATH, keeping any ?query. */
export function applyUrlFor(ats: string, url: string): string {
  const suffix = ats === "lever" || /apply\.workable\.com\/[^/]+\/j\//i.test(url) || /ats\.rippling\.com\/[^/]+\/jobs\//i.test(url) ? "apply" : ats === "ashby" ? "application" : null;
  if (!suffix) return url;
  try {
    const u = new URL(url);
    if (!new RegExp(`/${suffix}/?$`).test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, `/${suffix}`);
    return u.toString();
  } catch {
    return url;
  }
}

/** Tag every visible form control and describe it. */
export async function collectFields(page: Page): Promise<Field[]> {
  return page.evaluate(() => {
    const out: Field[] = [];
    const seenGroup = new Set<string>();
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    /** Visible text of a label, without tooltips, popovers or screen-reader-only helper text. */
    const textOf = (n: Element | null | undefined): string => {
      if (!n) return "";
      const c = n.cloneNode(true) as Element;
      c.querySelectorAll("[role=tooltip], [class*=tooltip], [class*=popover], [class*=Tooltip], [hidden], [aria-hidden=true], .sr-only, .visually-hidden, [class*=info-text], [class*=definition]").forEach((x) => x.remove());
      return clean(c.textContent);
    };
    const shownBox = (el: Element | null) => {
      if (!el) return false;
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    const visible = (el: Element) => {
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (type === "file" || shownBox(el)) return true;
      // Custom-drawn radios/checkboxes (Ashby, many React forms): the input is hidden, its label isn't.
      if (type === "radio" || type === "checkbox") {
        const id = el.getAttribute("id");
        const lab = (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null) ?? el.closest("label");
        return shownBox(lab) || shownBox(el.parentElement);
      }
      return false;
    };
    const CONTROL = "input:not([type=hidden]), select, textarea, [role=combobox]";
    /**
     * The question a control belongs to: the nearest heading-like element before it that is not itself
     * an answer choice (a label wrapping an input). Handles Lever's ".application-label", fieldset legends,
     * and "label above the field" layouts.
     */
    const questionText = (el: Element): string => {
      const legend = el.closest("fieldset")?.querySelector("legend");
      if (legend && !legend.contains(el)) return textOf(legend);
      let a: Element | null = el.parentElement;
      for (let depth = 0; a && depth < 7 && a.tagName !== "FORM" && a.tagName !== "BODY"; depth++, a = a.parentElement) {
        const cands = Array.from(a.querySelectorAll("legend, label, .application-label, [class*=label], [class*=question-title], [class*=Question] > p, h3, h4")).filter(
          (c) => !c.contains(el) && !c.querySelector(CONTROL) && !c.closest("label")?.querySelector(CONTROL) && clean(c.textContent) && c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
        );
        if (cands.length) return textOf(cands[cands.length - 1]);
      }
      return "";
    };
    /** Text of one control's own label (for a choice: the choice text). */
    const ownLabel = (el: Element): string => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const aria = el.getAttribute("aria-label");
      const labelledby = el.getAttribute("aria-labelledby");
      const lb = labelledby ? labelledby.split(/\s+/).map((x) => document.getElementById(x)?.textContent ?? "").join(" ") : "";
      return clean(textOf(byFor) || aria || lb || textOf(el.closest("label")) || (el as HTMLInputElement).value || "");
    };
    const labelFor = (el: Element): string => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      // A dropdown button's own text ("Select One Required" on Workday) is a placeholder, not the question.
      const rawAria = el.getAttribute("aria-label") ?? "";
      const aria = /^\s*(select( one)?|choose( one)?|please select)\b[\s\w]{0,20}$/i.test(rawAria) ? "" : rawAria;
      const labelledby = el.getAttribute("aria-labelledby");
      const lb = labelledby ? labelledby.split(/\s+/).map((x) => document.getElementById(x)?.textContent ?? "").join(" ") : "";
      // Workday: the question is the formField's <label>, which isn't tied to the button by for=.
      const wdField = el.closest("[data-automation-id^=formField-]");
      const wdLabel = wdField ? textOf(wdField.querySelector("label, legend")) : "";
      return clean(textOf(byFor) || aria || lb || textOf(el.closest("label")) || wdLabel || questionText(el) || el.getAttribute("placeholder") || el.getAttribute("name") || "");
    };
    const titleMarked = (el: Element) => {
      const id = el.getAttribute("id");
      const title =
        el.closest("fieldset")?.querySelector(":scope > label, :scope > legend, label, legend") ??
        (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null) ??
        el.closest("[data-field-path], .application-question, [class*=field]")?.querySelector("label, [class*=label]");
      if (!title || title.querySelector("input")) return false;
      if (/(^|[\s_-])required/i.test(title.className)) return true;
      const after = getComputedStyle(title, "::after").content + getComputedStyle(title, "::before").content;
      return /\*|✱/.test(after);
    };
    const isRequired = (el: Element, label: string) => {
      const input = el as HTMLInputElement;
      if (titleMarked(el)) return true;
      // "Select One Required" (Workday) / aria-label ending in "required".
      if (/\brequired\s*$/i.test(el.getAttribute("aria-label") ?? "")) return true;
      const wdLabel = el.closest("[data-automation-id^=formField-]")?.querySelector("label, legend");
      if (wdLabel && /[*✱]/.test(wdLabel.textContent ?? "")) return true;
      return (
        input.required ||
        el.getAttribute("aria-required") === "true" ||
        /[*✱]\s*(\(required\))?\s*$/.test(label) ||
        /\(required\)\s*$/i.test(label) ||
        Boolean(el.closest(".required-field, [class*=required-field]"))
      );
    };
    let n = 0;
    const isFilled = (el: Element): boolean => {
      const input = el as HTMLInputElement;
      const t = (input.type || "").toLowerCase();
      if (el.tagName === "SELECT") return (el as HTMLSelectElement).selectedIndex > 0;
      if (t === "checkbox" || t === "radio") return input.checked;
      if (el.tagName === "BUTTON") return !/^\s*(select one|select|choose)\b/i.test(el.textContent ?? "") && clean(el.textContent).length > 0;
      return Boolean(input.value && input.value.trim());
    };
    const els = Array.from(document.querySelectorAll("input, textarea, select, [role=combobox], button[aria-haspopup=listbox]"));
    for (const el of els) {
      const input = el as HTMLInputElement;
      const type = (input.type || "").toLowerCase();
      if (["hidden", "submit", "search", "image", "reset"].includes(type)) continue;
      if (type === "button" && el.getAttribute("aria-haspopup") !== "listbox") continue;
      if (!visible(el)) continue;
      if (el.closest("[aria-hidden=true]") && type !== "file") continue;
      // Bot traps ("honeypots") real people never see or fill, and controls handled elsewhere.
      if (/beecatcher|honeypot|hp_|website_url_confirm/i.test(`${el.getAttribute("data-automation-id") ?? ""} ${input.name ?? ""} ${el.id}`)) continue;
      if (el.closest("[data-9to5-skip]")) continue;
      // Hidden checkbox behind an Ashby Yes/No button pair — the buttons are the question.
      if (type === "checkbox" && el.parentElement?.querySelector(":scope > button[data-option]")) continue;

      // Radio groups, and checkbox lists that share one name ("Which teams interest you?"), are ONE question.
      if (type === "radio" || type === "checkbox") {
        const name = input.name;
        let group = name ? Array.from(document.querySelectorAll(`input[type=${type}][name="${CSS.escape(name)}"]`)).filter(visible) : [el];
        if (type === "checkbox" && group.length <= 1) {
          const box = el.closest("fieldset, [role=group], [data-automation-id^=formField], .application-question");
          const inBox = box ? Array.from(box.querySelectorAll("input[type=checkbox]")).filter(visible) : [];
          if (inBox.length > 1) {
            group = inBox;
            if (seenGroup.has(`box:${inBox[0].id || inBox[0].getAttribute("data-9to5") || ""}`)) continue;
          }
        }
        if (group.length > 1 && group[0] !== el && group.includes(el) && group.some((g) => g.hasAttribute("data-9to5"))) continue;
        if (type === "radio" || group.length > 1) {
          if (name && seenGroup.has(`${type}:${name}`)) continue;
          if (name) seenGroup.add(`${type}:${name}`);
          const id = `f${n++}`;
          group.forEach((g, i) => g.setAttribute("data-9to5", `${id}_${i}`));
          const q = questionText(el) || clean(name);
          out.push({
            id,
            label: q,
            kind: type === "radio" ? "radio" : "checkboxes",
            required: group.some((g) => (g as HTMLInputElement).required) || isRequired(el, q),
            options: group.map((g) => ownLabel(g)),
            filled: group.some((g) => (g as HTMLInputElement).checked),
          });
          continue;
        }
      }

      const id = `f${n++}`;
      el.setAttribute("data-9to5", id);
      let label = labelFor(el);
      if (/^(start|end|from|to|graduation)?\s*(date|month|year)?\s*[*✱]?$/i.test(label) && label.length < 25) {
        // Which section is this in? ("Education", "Work experience"…)
        let sec = "";
        for (let a: Element | null = el.parentElement; a && !sec && a.tagName !== "BODY"; a = a.parentElement) {
          // The closest heading-like text above the field inside this ancestor (not the form's first heading).
          const heads = Array.from(
            a.querySelectorAll("h1, h2, h3, h4, h5, legend, [class*=section-title], [class*=sectionTitle], [class*=SectionHeader], [class*=heading], label")
          ).filter((h) => !h.contains(el) && !h.querySelector("input, select, textarea") && h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
          const named = heads.map((h) => textOf(h)).filter((t) => t && !/^(start|end|from|to)?\s*(date|month|year)?\s*[*✱]?$/i.test(t));
          if (named.length) sec = named[named.length - 1].slice(0, 60);
        }
        const first = el.tagName === "SELECT" ? ((el as HTMLSelectElement).options[0]?.text ?? "") : el.getAttribute("placeholder") ?? "";
        const part = /month/i.test(first) ? " (month)" : /year/i.test(first) ? " (year)" : /day/i.test(first) ? " (day)" : "";
        label = `${sec ? `${sec} — ` : ""}${label}${part}`;
      }
      const required = isRequired(el, label);
      if (el.tagName === "SELECT") {
        const opts = Array.from((el as HTMLSelectElement).options)
          .map((o) => o.text.trim())
          .filter((t) => t && !/^(select|choose|please select|--)/i.test(t));
        out.push({ id, label, kind: "select", required, options: opts, filled: isFilled(el) });
      } else if ((el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox") && el.tagName !== "SELECT") {
        out.push({ id, label, kind: "combobox", required, options: [], filled: isFilled(el) });
      } else if (type === "file") {
        out.push({ id, label, kind: "file", required, options: [] });
      } else if (type === "checkbox") {
        // A single checkbox: usually a consent ("I agree…") — its own text is the question.
        out.push({ id, label: ownLabel(el) || label, kind: "checkbox", required, options: [], filled: isFilled(el) });
      } else {
        out.push({ id, label, kind: el.tagName === "TEXTAREA" ? "textarea" : "text", required, options: [], filled: isFilled(el) });
      }
    }
    // Yes/No answered with two buttons (Ashby): one radio-like question per pair.
    const pairs = new Set<Element>();
    document.querySelectorAll("button[data-option]").forEach((b) => b.parentElement && pairs.add(b.parentElement));
    for (const box of pairs) {
      const btns = Array.from(box.querySelectorAll(":scope > button[data-option]")).filter(shownBox);
      if (btns.length < 2 || btns.some((b) => b.hasAttribute("data-9to5"))) continue;
      const id = `f${n++}`;
      btns.forEach((b, i) => b.setAttribute("data-9to5", `${id}_${i}`));
      const entry = box.closest("[data-field-path], [data-field-entry-id], fieldset") ?? box.parentElement;
      const lab = entry?.querySelector("label");
      const q = textOf(lab) || questionText(btns[0]);
      out.push({
        id,
        label: q,
        kind: "radio",
        // Ashby marks required questions on the label; when unsure, treat as required (an answer never hurts).
        required: !lab || /required/i.test(lab.className) || isRequired(btns[0], q) || true,
        options: btns.map((b) => clean(b.textContent)),
        filled: btns.some((b) => b.getAttribute("aria-pressed") === "true"),
      });
    }
    return out;
  });
}

/**
 * Yes/No answer mapped onto the form's options. Some forms use statements instead of Yes/No
 * ("I am authorized to work in the United States for any employer" / "…for my present employer only" /
 * "I require sponsorship…"): pick the unqualified positive statement for Yes, the negative one for No.
 */
export const yesNo = (f: Field, yes: boolean): string => {
  if (!f.options.length) return yes ? "Yes" : "No";
  const direct = pickOption(yes ? "Yes" : "No", f.options);
  if (direct) return direct;
  const opts = f.options.filter((o) => !/^(select|choose)/i.test(o));
  const qualified = /\b(only|unknown|unsure|not sure|depends|prefer not|decline)\b/i;
  const negative = /\b(not|no|unable|cannot|can.?t|don.?t|do not|won.?t|will not)\b/i;
  if (yes) return opts.find((o) => !negative.test(o) && !qualified.test(o) && !/\brequire/i.test(o)) ?? opts.find((o) => !negative.test(o)) ?? "Yes";
  return opts.find((o) => negative.test(o) && !qualified.test(o)) ?? "No";
};

/** Answers we know without asking the AI (free). */
export function knownValue(f: Field, a: Applicant): string | null {
  const l = f.label.toLowerCase();
  if (f.kind === "file") return /cover/.test(l) ? null : /resume|cv|attach/.test(l) || f.required ? "__RESUME__" : null;
  if (/password/.test(l)) return a.portal?.password ?? null;
  if (/first name|given name|preferred first|preferred name|nickname/.test(l)) return a.first_name;
  if (/last name|family name|surname/.test(l)) return a.last_name;
  if (/^(full )?name\b|your name|legal name/.test(l) && !/company|school|reference|employer/.test(l)) return `${a.first_name} ${a.last_name}`;
  // The email address goes only into a text box that asks for it — not into consent dropdowns that mention email.
  // …and never into a question about someone else ("What's their name or email address?" = the referrer).
  const aboutSomeoneElse = /\b(their|referr\w*|who referred|reference|recruiter|manager|supervisor|emergency)\b/.test(l);
  if (/e-?mail/.test(l) && f.kind === "text" && l.length < 80 && !aboutSomeoneElse) return a.portal?.email && /account|login|user/.test(l) ? a.portal.email : a.email;
  // \b so "phonetic" or "mobile apps" don't count as a phone field.
  // Not "Phone Device Type", "Country Phone Code" or "Phone Extension" — those aren't the number.
  if (
    /\b(phone|mobile|cell)( number| no\.?)?\b(?! app)/.test(l) &&
    !/phonetic|device|type|country|code|extension|\bext\b/.test(l) &&
    f.kind !== "radio" &&
    f.kind !== "checkbox" &&
    f.kind !== "select" &&
    f.kind !== "combobox"
  )
    return a.phone ?? null;
  if (/phone extension|\bext\b/.test(l)) return null;
  // GPA / class rank: only from the resume — never guessed (left empty when the resume has none).
  if (/\bgpa\b|grade point|class rank|overall result/.test(l)) return a.gpa ?? null;
  // A field that's just "City" gets the city; "Location" / "City, State" get both.
  if (/^city\b[\s*✱]*$/.test(l) && a.city) return a.city;
  const howHeard = /(hear|learn|find out|found|source|referr)/.test(l);
  if (/linkedin/.test(l) && !howHeard && f.kind !== "select" && f.kind !== "radio") return a.linkedin_url ?? null;
  if (/github/.test(l) && !howHeard) return a.github_url ?? null;
  // A link only goes into a short text field that asks for one — not a question that merely mentions "website".
  if (/website|portfolio|personal (site|url)/.test(l) && f.kind === "text" && l.length < 60 && !/\?/.test(l)) return a.website_url ?? a.github_url ?? null;
  if ((/^(current )?(location|city)\b|where are you (located|based)/.test(l) || /city.{0,10}state/.test(l)) && f.kind !== "radio" && f.kind !== "checkbox")
    return [a.city, a.state].filter(Boolean).join(", ") || null;
  if (/^state\b|state of residence|province/.test(l) && f.kind !== "radio" && a.state) return f.options.length ? pickOption(a.state, f.options) : a.state;
  if (/^country\b|country of residence/.test(l) && f.kind !== "radio" && f.kind !== "checkbox") {
    const c = a.answers?.country || (a.state ? "United States" : "");
    if (c) return f.options.length ? (pickOption(c, f.options) ?? f.options.find((o) => /^(united states|usa|us)\b/i.test(o)) ?? null) : c;
  }
  if (/zip|postal/.test(l) && a.answers?.zip) return a.answers.zip;
  // The school name only where a school is asked for — not "Have you ever worked at The American College of…?".
  if (
    /(school|university|college|institution)/.test(l) &&
    !/high school/.test(l) &&
    !/\b(worked|employed|work for|affiliat|have you|are you|were you|do you|did you|relative|refer)\b|\?/.test(l) &&
    (f.kind === "text" || f.kind === "combobox") &&
    a.school
  )
    return a.school;
  if (/graduat/.test(l) && /date|year|when|expected/.test(l) && f.kind === "text" && a.graduation_date) return a.graduation_date;
  // Sponsorship before authorization: "authorized … without sponsorship" questions mention both.
  // Only real questions about NEEDING sponsorship — not notices like "sponsorship is not available, select Yes to confirm".
  const asksSponsorship =
    (/(require|need|requiring|needing).{0,60}sponsor|sponsor.{0,40}(require|need)/.test(l) ||
      /(file|submit)s? (a )?petition|employment.?based immigration|immigration (status|sponsorship|benefit)|(h-?1b|o-1|tn) (visa|status)/.test(l)) &&
    !/not (available|allowed|offered|provided)|unable to (sponsor|offer)|please confirm|confirm (that|your)/.test(l);
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
  if (/commut/.test(l)) return null;
  const key = questionFor(f.label)?.key;
  const saved = answerFromProfile(f.label, f.options, a.answers ?? {});
  // "Referral" as the saved source means "use the best option": a referral choice makes forms ask for the
  // referrer's name, so pick LinkedIn / a job board instead (applicant's instruction).
  if (saved && !(key === "how_heard" && /referr/i.test(saved))) return saved;
  // Pay as a plain number (numeric-only fields reject "Negotiable"): the user's figure, else 90,000.
  if (key === "desired_salary" && (f.kind === "text" || f.kind === "textarea")) {
    const pay = salaryFacts(a.answers ?? {}, a.custom ?? {});
    return /hour|hourly|per hour/i.test(l) && !/salary or hourly|annual/i.test(l) ? String(pay.hourly_rate_usd) : String(pay.annual_salary_usd);
  }
  // Same common question, different wording ("expected compensation" ≈ "Desired Pay" the user answered).
  if (key && a.custom) {
    for (const [q, ans] of Object.entries(a.custom)) {
      if (ans && questionFor(q)?.key === key) {
        const v = f.options.length ? pickOption(ans, f.options) : ans;
        if (v) return v;
      }
    }
  }
  const opts = f.kind === "checkbox" ? ["Yes", "No"] : f.options;
  // The user's own answer to this (or a very similar) question beats anything the AI said before.
  const mine = findSimilarAnswer(f.label, opts, a.custom ?? {});
  if (mine) return mine;
  // Sensible defaults for low-stakes questions ("How did you hear about us?" → LinkedIn, referral → No…).
  // Before remembered AI answers, so an old AI guess (e.g. "Referral") can't keep coming back.
  const sense = commonSenseAnswer(f.label, opts, f.kind);
  if (sense) return sense;
  const remembered = findSimilarAnswer(f.label, opts, a.memory ?? {}, 0.85);
  if (remembered) return remembered;
  return null;
}

export const captchaVisible = (page: Page) =>
  page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe"));
    // Only a puzzle a person would actually see counts. Lever/Ashby keep invisible hCaptcha/reCAPTCHA
    // frames on every page (visibility:hidden, "enclave" frames, size=invisible) that pass silently.
    const shown = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const st = getComputedStyle(e);
        if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
      }
      return true;
    };
    return frames.some((f) => {
      const src = f.getAttribute("src") ?? "";
      const r = f.getBoundingClientRect();
      const title = f.getAttribute("title") ?? "";
      if (!/hcaptcha|recaptcha\/(api2|enterprise)\/(anchor|bframe)|challenges\.cloudflare|turnstile/.test(src) && !/captcha|challenge/i.test(title)) return false;
      if (/size=invisible/.test(src)) return false;
      const onScreen = r.width > 60 && r.height > 60 && r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3;
      return onScreen && shown(f);
    });
  });

export async function fill(page: Page, f: Field, value: string, resumePath: string) {
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
      if (idx < 0) return;
      const target = `[data-9to5="${f.id}_${idx}"]`;
      const tag = await page.evaluate((s2) => document.querySelector(s2)?.tagName ?? "", target);
      if (tag === "BUTTON") {
        await page.click(target);
        return;
      }
      const ok = await page.check(target, { timeout: 2000 }).then(() => true).catch(() => false);
      if (ok) return;
      const forId = await page.getAttribute(target, "id").catch(() => null);
      if (forId && (await page.locator(`label[for="${forId}"]`).count())) await page.click(`label[for="${forId}"]`).catch(() => {});
      else await page.click(target, { force: true }).catch(() => {});
      return;
    }
    case "checkboxes": {
      // The answer may list several choices: "Backend, Cloud infrastructure".
      const wanted = value.split(/\s*[,;|]\s*|\s+and\s+/).filter(Boolean);
      for (const w of wanted) {
        const hit = pickOption(w, f.options);
        const idx = hit ? f.options.indexOf(hit) : -1;
        if (idx >= 0) await page.check(`[data-9to5="${f.id}_${idx}"]`).catch(() => page.click(`[data-9to5="${f.id}_${idx}"]`, { force: true }));
      }
      return;
    }
    case "combobox": {
      await page.click(sel);
      await page.waitForTimeout(400);
      const list = await page.getAttribute(sel, "aria-controls").catch(() => null);
      const scope = list ? `[id="${list}"] ` : "";
      const option = page.locator(`${scope}[role=option]`).filter({ hasText: value }).first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        return;
      }
      const tag = await page.evaluate((s2) => document.querySelector(s2)?.tagName ?? "", sel);
      if (tag === "INPUT") await page.fill(sel, value).catch(() => page.keyboard.type(value));
      else await page.keyboard.type(value, { delay: 30 });
      await page.waitForTimeout(800);
      await page.keyboard.press("Enter");
      return;
    }
  }
}

/** After a resume upload, sites parse it and re-render the form. Wait until the form stops changing. */
export async function waitForFormToSettle(page: Page, maxMs = 25000) {
  const snapshot = () =>
    page
      .evaluate(() => {
        const busy = /(parsing|analy[sz]ing|uploading|reading) (your )?(resume|cv|file)|autofilling/i.test(document.body.innerText);
        const vals = Array.from(document.querySelectorAll("input, textarea, select"))
          .map((e) => (e as HTMLInputElement).value ?? "")
          .join("|");
        return `${busy}:${vals.length}:${vals.slice(0, 2000)}`;
      })
      .catch(() => "");
  const start = Date.now();
  let last = await snapshot();
  let stableFor = 0;
  await page.waitForTimeout(1200);
  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(1000);
    const now = await snapshot();
    if (now === last && !now.startsWith("true")) stableFor++;
    else stableFor = 0;
    last = now;
    if (stableFor >= 2) return;
  }
}

/** Re-tag the form after a re-render wiped our markers; maps old fields to new ones by question + kind. */
async function retag(page: Page, fields: Field[]) {
  const fresh = await collectFields(page);
  const used = new Set<string>();
  for (const f of fields) {
    const m = fresh.find((x) => !used.has(x.id) && x.kind === f.kind && x.label === f.label);
    if (m) {
      used.add(m.id);
      f.id = m.id;
    }
  }
}

/** Custom dropdowns (React-Select etc.) only list their choices once opened — open each, read, close. */
export async function readComboboxOptions(page: Page, fields: Field[]) {
  for (const f of fields.filter((x) => x.kind === "combobox" && !x.options.length).slice(0, 25)) {
    const sel = `[data-9to5="${f.id}"]`;
    try {
      await page.click(sel, { timeout: 2000 });
      await page.waitForTimeout(350);
      // Only this dropdown's own list (aria-controls), not e.g. the phone field's hidden country list.
      const list = await page.getAttribute(sel, "aria-controls").catch(() => null);
      const scope = list ? `[id="${list}"] ` : "";
      const opts = await page
        .locator(`${scope}[role=option], ${scope}[class*='select__option']`)
        .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean));
      f.options = [...new Set(opts)].slice(0, 60);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    } catch {
      // leave it as free text
    }
  }
}

/** Testing aid: with APPLY_DEBUG_DIR set, keep a screenshot, the page text and the result of every attempt. */
async function saveDebug(context: import("playwright").BrowserContext, company: string, r: ApplyResult) {
  const dir = process.env.APPLY_DEBUG_DIR;
  // Successes need no evidence; everything else gets a screenshot to diagnose from.
  if (!dir || ((r.status === "submitted" || r.status === "closed") && !process.env.APPLY_DEBUG_ALL)) return;
  try {
    const { mkdirSync, writeFileSync } = await import("fs");
    mkdirSync(dir, { recursive: true });
    const page = context.pages().at(-1);
    const base = `${dir}/${company.replace(/[^a-z0-9]+/gi, "_")}_${Date.now()}`;
    if (page) {
      await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
      const text = ((await page.innerText("body").catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 20000);
      writeFileSync(`${base}.txt`, `${page.url()}\n\n${text}`);
    }
    writeFileSync(`${base}.json`, JSON.stringify(r, null, 1));
  } catch {
    // debugging only
  }
}

/**
 * Answers for a set of form fields: profile/known values first (free), then — only if a required
 * question is still blank — one AI call for those plus optional "stand out" free-text questions.
 */
export async function answerFields(
  db: SupabaseClient,
  fields: Field[],
  opts: ApplyOpts
): Promise<{ answers: Record<string, string>; learned: { label: string; answer: string }[]; aiCalls: number; quota?: boolean }> {
  let aiCalls = 0;
    const answers: Record<string, string> = {};
    const unknown: Field[] = [];
    for (const f of fields) {
      const v = knownValue(f, opts.applicant);
      if (v) answers[f.id] = v;
      else unknown.push(f);
    }

    // AI only when a REQUIRED question is still blank. Optional free-text questions that help an
    // application stand out ("Why us?", "Anything else?", cover letter) ride along in the same call.
    const learned: { label: string; answer: string }[] = [];
    const required = unknown.filter((f) => f.required && f.kind !== "file" && !f.filled);
    const standOut = unknown.filter((f) => !f.required && (f.kind === "textarea" || STAND_OUT.test(f.label)) && f.kind !== "file" && !/password/i.test(f.label));
    const optionalChoices = unknown.filter((f) => !f.required && !f.filled && f.options.length > 0 && f.kind !== "checkbox" && !/(pronoun|preferred name|middle name|suffix|prefix)/i.test(f.label));
    // Only a REQUIRED unanswered question pays for an AI call (free quota: 250/day); optional ones ride along.
    const needAi = required.length ? [...required, ...optionalChoices.slice(0, 10), ...standOut.slice(0, 3)] : [];
    if (needAi.length) {
      const facts = {
        name: `${opts.applicant.first_name} ${opts.applicant.last_name}`,
        location: [opts.applicant.city, opts.applicant.state].filter(Boolean).join(", "),
        school: opts.applicant.school,
        graduation: opts.applicant.graduation_date,
        authorized_to_work_in_us: opts.applicant.work_authorized_us,
        needs_visa_sponsorship: opts.applicant.sponsorship_needed,
        willing_to_relocate: opts.applicant.relocation ?? true,
        preferences: salaryFacts(opts.applicant.answers ?? {}, opts.applicant.custom ?? {}),
        jobs: (opts.applicant.experience ?? []).map((e) => `${e.title} @ ${e.company} (${e.start ?? "?"} – ${e.end ?? "?"})`),
        saved_answers: opts.applicant.answers ?? {},
        // Trimmed so the whole prompt fits Groq's 8,000 tokens/minute (and costs Gemini less).
        resume: opts.applicant.resume_text.replace(/\s+/g, " ").slice(0, 4500),
        job_description: (opts.jobDescription ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2500),
      };
      try {
        aiCalls++;
        const ai = await geminiJson<Record<string, string | null>>(
          db,
          answerPrompt({
            name: facts.name,
            jobTitle: opts.jobTitle,
            company: opts.company,
            facts,
            questions: needAi.map((f) => ({ id: f.id, question: f.label, type: f.kind, options: f.options.slice(0, 40), required: f.required })),
          }),
          [],
          opts.userId,
          // Groq first (≈2,500 free requests/day vs Gemini's ≈210); Gemini only if Groq can't.
          { prefer: "fallback", maxTokens: 1800 }
        );
        for (const f of needAi) {
          const v = ai[f.id];
          if (v != null && String(v).trim()) {
            answers[f.id] = String(v);
            if (f.kind !== "checkbox") learned.push({ label: f.label, answer: String(v) });
          }
        }
      } catch (e) {
        if (e instanceof FreeTierLimitError) return { answers, learned, aiCalls, quota: true };
        throw e;
      }
    }

    return { answers, learned, aiCalls };
}

/** Hard limit for one application, so a slow or broken site can't hold up the whole run. */
const APPLY_TIMEOUT_MS = Number(process.env.APPLY_TIMEOUT_S ?? "240") * 1000;

/** Fill and (unless dryRun) submit one application. */
export async function applyToJob(
  browser: Browser,
  db: SupabaseClient,
  opts: ApplyOpts
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
    // Workday is several pages plus account sign-in/verification: give it more time.
    const limit = opts.ats === "workday" ? APPLY_TIMEOUT_MS * 2 : APPLY_TIMEOUT_MS;
    timer = setTimeout(() => resolve({ status: "failed", detail: `Timed out after ${Math.round(limit / 1000)}s — will retry next run` }), limit);
  });
  try {
    const r = await Promise.race([fillAndSubmit(context, db, opts), timeout]);
    await saveDebug(context, opts.company, r);
    return r;
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => {});
  }
}

async function fillAndSubmit(
  context: import("playwright").BrowserContext,
  db: SupabaseClient,
  opts: ApplyOpts
): Promise<ApplyResult> {
  const page = await context.newPage();
  // Default is 30s per action; a missing field would otherwise stall the run for minutes.
  page.setDefaultTimeout(4000);
  page.setDefaultNavigationTimeout(30000);
  let aiCalls = 0;
  const t0 = Date.now();
  if (opts.ats === "workday" || /myworkday(jobs|site)\.com/i.test(opts.url)) return applyWorkday(page, db, opts);
  try {
    const res = await page.goto(applyUrlFor(opts.ats, opts.url), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    const body = (await page.innerText("body").catch(() => "")) ?? "";
    if ((res && res.status() === 404) || CLOSED.test(body.slice(0, 4000))) return { status: "closed", detail: "Posting is closed" };

    // Greenhouse sometimes needs an "Apply" click to reveal the form.
    const applyBtn = page.locator("button:has-text('Apply'), a:has-text('Apply for this job')").first();
    if ((await page.locator("form input[type=file]").count()) === 0 && (await applyBtn.count()) > 0) {
      await applyBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Many forms (Ashby, Lever) parse the resume on upload and autofill fields — do that first,
    // so the autofill can't overwrite answers filled afterwards.
    const tick = (what: string) => process.env.APPLY_DEBUG_DIR && console.log(`[9to5]   t+${Math.round((Date.now() - t0) / 1000)}s ${what}`);
    tick("page open");
    const resumeInput = page.locator("input[type=file]").first();
    if ((await resumeInput.count()) && opts.resumePath) {
      await resumeInput.setInputFiles(opts.resumePath).catch(() => {});
      await waitForFormToSettle(page);
    }
    tick("resume uploaded");
    const fields = await collectFields(page);
    tick(`read ${fields.length} fields`);
    await readComboboxOptions(page, fields);
    tick("read dropdowns");
    if (!fields.some((f) => f.kind === "file") && !fields.some((f) => /e-?mail/i.test(f.label)))
      return { status: "needs_user", detail: "Couldn't find the application form" };

    const ans = await answerFields(db, fields, opts);
    if (ans.quota) return { status: "needs_user", detail: "AI quota used up today — finish this one yourself or it retries tomorrow", answers: labelled(fields, ans.answers), aiCalls: ans.aiCalls };
    const { answers, learned } = ans;
    aiCalls += ans.aiCalls;
    const usedPortalLogin = fields.some((f) => /password/i.test(f.label) && answers[f.id]);

    const missing = fields.filter((f) => f.required && !answers[f.id] && !f.filled);
    if (missing.length) {
      const pending: PendingQuestion[] = missing.map((m) => ({
        key: memoryKey(m.label || m.id),
        label: m.label || "(unlabelled question)",
        kind: m.kind,
        options: m.kind === "checkbox" ? ["Yes", "No"] : m.options.slice(0, 60),
        required: true,
      }));
      return {
        status: "needs_user",
        detail: `Waiting on your answer to ${pending.length} question${pending.length === 1 ? "" : "s"} — answer once on this page and the agent reapplies`,
        answers: labelled(fields, answers),
        learned,
        aiCalls,
        pending,
      };
    }

    for (const f of fields) {
      const v = answers[f.id];
      if (!v) continue;
      if (f.kind === "file" && f.filled) continue;
      if (f.kind === "file" && v === "__RESUME__" && (await page.locator(`[data-9to5="${f.id}"]`).evaluate((e) => ((e as HTMLInputElement).files?.length ?? 0) > 0).catch(() => false))) continue;
      const marker = f.kind === "radio" || f.kind === "checkboxes" ? `[data-9to5^="${f.id}_"]` : `[data-9to5="${f.id}"]`;
      if (!(await page.locator(marker).count())) {
        tick("form re-rendered — re-tagging fields");
        await retag(page, fields);
      }
      const tf = Date.now();
      await fill(page, f, v === "__RESUME__" ? "" : v, opts.resumePath).catch(() => {});
      if (Date.now() - tf > 4000) tick(`slow fill (${Math.round((Date.now() - tf) / 1000)}s): ${f.kind} ${f.label.slice(0, 60)}`);
    }
    tick("filled");
    await page.waitForTimeout(1500);

    if (await captchaVisible(page)) return { status: "needs_user", detail: "Site shows a CAPTCHA — please submit this one yourself", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    if (opts.dryRun) return { status: "needs_user", detail: "Dry run: form filled but not submitted", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };

    const submit = page.locator("button[type=submit], input[type=submit], button:has-text('Submit application'), button:has-text('Submit')").last();
    if ((await submit.count()) === 0) return { status: "needs_user", detail: "Couldn't find the Submit button", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    const submittedAt = new Date();
    await submit.click();
    await page.waitForTimeout(6000);

    // Some sites (Greenhouse especially) email a security code after Submit and wait for it.
    const code = await enterEmailCode(page, opts.emailCode, submittedAt);
    if (code === "no_inbox")
      return { status: "needs_user", detail: "The site emailed you a security code. Connect your Gmail on the Autopilot page so the agent can enter it next time — or finish this one yourself.", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    if (code === "not_found")
      return { status: "needs_user", detail: "The site emailed a security code but it didn't arrive in time — open the application and enter it yourself.", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };

    const after = (await page.innerText("body").catch(() => "")) ?? "";
    if (code === "entered" && !SUCCESS.test(after) && ASKS_CODE.test(after) && /(incorrect|invalid|expired|wrong|doesn.t match|try again)/i.test(after))
      return { status: "needs_user", detail: "The site rejected the emailed security code — open the application and finish it (the answers are listed below).", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    if (SUCCESS.test(after) || /confirmation|thank/i.test(page.url())) return { status: "submitted", detail: "Application submitted", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    if (await captchaVisible(page)) return { status: "needs_user", detail: "CAPTCHA appeared on submit — please submit this one yourself", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    // Real validation messages only — not helper text like "please select all that apply".
    const err = after.match(/(your form needs corrections[^.]{0,40}|missing entry for required field:?[^.?]{0,120}|this field is required|(field|question|answer) is required|please (enter|fill in|complete|provide)[^.]{0,80}|(is )?invalid (email|phone|format|value)[^.]{0,40})/i)?.[0];
    return { status: "needs_user", detail: err ? `Form rejected: ${err}` : "Submitted but no confirmation seen — please check", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
  } catch (e) {
    return { status: "failed", detail: (e as Error).message.slice(0, 300), aiCalls };
  }
}

const CODE_BOXES = "input[id^='security-input'], input[autocomplete='one-time-code'], input[name*='security_code' i], input[name*='verification' i], input[aria-label*='code' i], input[placeholder*='code' i]";
const ASKS_CODE = /(security|verification|confirmation|one[- ]time) code|code (was |we('|’)ve |has been )?(sent|emailed)|enter the (\d+[- ]character )?code|check your email for a code/i;

/** If the page now asks for an emailed code, fetch it from the inbox and submit it. */
async function enterEmailCode(page: Page, emailCode: ((since: Date) => Promise<string | null>) | undefined, since: Date): Promise<"none" | "entered" | "no_inbox" | "not_found"> {
  const body = (await page.innerText("body").catch(() => "")) ?? "";
  if (!ASKS_CODE.test(body) || SUCCESS.test(body)) return "none";
  const boxes = page.locator(CODE_BOXES);
  const n = await boxes.count();
  if (!n) return "none";
  if (!emailCode) return "no_inbox";
  const code = await emailCode(since).catch((e) => {
    console.log(`[9to5]   email code lookup failed: ${(e as Error).message}`);
    return null;
  });
  if (!code) return "not_found";
  if (n > 1 && n >= code.length) for (let i = 0; i < code.length; i++) await boxes.nth(i).fill(code[i]);
  else await boxes.first().fill(code);
  await page.waitForTimeout(500);
  const again = page.locator("button[type=submit], input[type=submit], button:has-text('Submit'), button:has-text('Verify')").last();
  if (await again.count()) await again.click().catch(() => {});
  await page.waitForTimeout(6000);
  return "entered";
}

/** Answers keyed by the question text (what the user sees), not internal field ids. */
export function labelled(fields: Field[], answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = answers[f.id];
    if (!v || f.kind === "file" || /password/i.test(f.label)) continue;
    out[f.label || f.id] = v;
  }
  return out;
}
