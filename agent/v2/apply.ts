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
  experience?: { title: string; company: string; start?: string | null; end?: string | null; location?: string | null; bullets?: string[] }[];
  /** Skills from the resume and profile (for "Skills" boxes and skill questions). */
  skills?: string[];
  /** GPA exactly as on the resume, if it lists one. */
  gpa?: string | null;
  /** Schools from the parsed resume (most recent first). */
  education?: { school?: string | null; degree?: string | null; field?: string | null; graduation?: string | null; gpa?: string | null }[];
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
  emailCode?: (since: Date, company?: string) => Promise<string | null>;
  /** Reads a "verify your account" link a site emailed (Workday account creation). */
  /** `host`: the portal the link should point at (e.g. acme.wd5.myworkdayjobs.com). */
  emailLink?: (since: Date, match: RegExp, host?: string, waitMs?: number) => Promise<string | null>;
  /** True when this portal account was already created on an earlier run. */
  accountExists?: boolean;
  /** Fields whose earlier answer the site rejected: skip saved answers and ask the AI with the real options. */
  forceAi?: (f: Field) => boolean;
  /** Writes a cover letter PDF for this job (only called when a form requires one). */
  coverLetter?: () => Promise<string | null>;
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
  /** Repeating resume blocks (Greenhouse "Employment" / "Education"): which block, 0-based. */
  section?: "employment" | "education";
  index?: number;
}

const STAND_OUT = /(why (do you|are you|this|our|us)|cover letter|anything else|additional (information|comments)|tell us|what (excites|interests)|interest(ed)? in)/i;
/** Confirmation wording across ATSs ("Thank you for applying", Ashby "Thanks so much for applying", Lever "Thanks for applying!"…). */
export const SUCCESS =
  /thank(s| you)( so much| very much)? for (applying|your (application|submission)|submitting)|application (has been |was )?(successfully )?(received|submitted|sent)|we('|’)ve (successfully )?received your application|we have (successfully )?received your application|successfully (submitted|applied)|application submitted|congratulations[^.]{0,40}(submitted|applied)|you('|’)ve (successfully )?applied|your application is (in|complete)/i;
const CLOSED = /no longer (accepting|available|open)|job (is )?(closed|not found)|position has been filled|page (you('|’)re looking for )?(could not be|not) found/i;

/** The page with the form: Lever "…/apply", Ashby "…/application" — added to the PATH, keeping any ?query. */
export function applyUrlFor(ats: string, url: string): string {
  // Jobvite: the posting page only links to the form; go straight to …/job/<id>/apply.
  if (/jobs\.jobvite\.com\/[^/]+\/job\/[^/?#]+/i.test(url)) {
    try {
      const u = new URL(url);
      u.search = "";
      if (!/\/apply\/?$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, "/apply");
      return u.toString();
    } catch {
      return url;
    }
  }
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
        // Greenhouse labels both upload buttons "Attach": name the slot by its group ("Resume/CV", "Cover Letter") or id.
        const generic = !label || /^(attach|upload|browse|choose( a)? file|select file|drop files?)\b/i.test(label);
        const isGeneric = (t: string) => !t || /^(attach|upload|browse|choose( a)? file|select file|drop files?|or drag)\b/i.test(t);
        const group = el.closest("[class*=upload i], [class*=file i], [class*=field i], fieldset")?.querySelector("legend, h3, h4, [class*=label]:not(label), [id*=label i]:not(label)");
        const fileLabel = !generic
          ? label
          : [textOf(group), questionText(el), clean(`${input.id} ${input.name}`.replace(/[_-]+/g, " "))].find((t) => !isGeneric(t)) || label;
        out.push({ id, label: fileLabel, kind: "file", required: required || /resume|cv/i.test(`${input.id} ${input.name}`), options: [] });
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
    // Repeating resume blocks (Greenhouse "Employment" and "Education", one block per job/degree, "Add another"):
    // their fields share labels ("Start date year" twice), so name them by block — "Employment 1 — Start date year" —
    // and let the answer code fill them from the resume instead of the AI or remembered answers.
    for (const f of out) {
      const el = document.querySelector(`[data-9to5="${f.id}"], [data-9to5="${f.id}_0"]`);
      if (!el) continue;
      const box = el.closest("[class*=employment-form], [class*=employment--form], [class*=education--form], [class*=education-form]");
      if (!box) continue;
      const section = /employment/i.test(box.className) ? "employment" : "education";
      const sel = section === "employment" ? "[class*=employment-form], [class*=employment--form]" : "[class*=education--form], [class*=education-form]";
      const fromId = (el.id || "").match(/-(\d+)(?:_\d+)?$/);
      const index = fromId ? Number(fromId[1]) : Math.max(0, Array.from(document.querySelectorAll(sel)).indexOf(box));
      f.section = section;
      f.index = index;
      f.label = `${section === "employment" ? "Employment" : "Education"} ${index + 1} — ${f.label}`;
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

/** Leave this field empty on purpose (e.g. the end date of the job you still have). */
export const SKIP = "__SKIP__";
/** Several things to try typing into a search-and-pick box, best first ("Software Engineering" → "Computer Science"…). */
export const ALT = " ||| ";
const straight = (s: string) => s.replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
const isCurrent = (end?: string | null) => !end || /present|current|now|ongoing|today/i.test(end);
const degreeYears = (deg?: string | null) => (/ph\.?d|doctor/i.test(deg ?? "") ? 5 : /master|m\.?s\b|m\.?eng|mba/i.test(deg ?? "") ? 2 : /associate/i.test(deg ?? "") ? 2 : 4);

/** What to type for a degree, with simpler fallbacks for pickers that don't have the exact wording. */
export function degreeChoices(deg: string): string[] {
  const d = straight(deg);
  if (/master/i.test(d)) return [d, "Master's Degree", "Master of Science", "Master's", "Master"];
  if (/bachelor/i.test(d)) return [d, "Bachelor's Degree", "Bachelor of Science", "Bachelor's", "Bachelor"];
  if (/ph\.?d|doctor/i.test(d)) return [d, "Doctor of Philosophy", "Ph.D.", "PhD", "Doctorate"];
  if (/associate/i.test(d)) return [d, "Associate's Degree", "Associate"];
  return [d];
}

/** What to type for a field of study: the resume's wording, then the closest common names. */
export function disciplineChoices(field: string): string[] {
  const f = straight(field);
  const out = [f];
  const words = f.split(/\s+/);
  if (/ and /i.test(f)) out.push(...f.split(/\s+and\s+/i).map((p, i, all) => (i === 0 && all[1] ? `${p} ${all[1].split(" ").slice(1).join(" ")}`.trim() : p)));
  if (words.length > 2) out.push(words.slice(-2).join(" "));
  // Greenhouse's list is coarse ("Computer Science", "Electronics", "Engineering" — no "Software Engineering").
  if (/electric/i.test(f)) out.push("Electrical Engineering", "Computer Engineering", "Electrical and Electronics Engineering", "Engineering", "Electronics");
  if (/software|computer|comput|information tech|data/i.test(f)) out.push("Computer Science", "Computer Engineering", "Software Engineering");
  if (/engineer/i.test(f)) out.push("Engineering");
  return [...new Set(out.map((x) => x.trim()).filter(Boolean))];
}

/**
 * Greenhouse-style "Employment N" / "Education N" blocks, filled from the N-th job / degree on the resume.
 * Returns undefined when the field isn't part of such a block, SKIP when it should stay empty.
 */
export function sectionValue(f: Field, a: Applicant): string | null | undefined {
  if (!f.section) return undefined;
  const i = f.index ?? 0;
  const l = f.label.replace(/^(employment|education) \d+ — /i, "").toLowerCase();
  const month = (p: { monthName: string } | null) => (p ? (f.options.length ? (pickOption(p.monthName, f.options) ?? p.monthName) : p.monthName) : null);
  if (f.section === "employment") {
    const job = a.experience?.[i];
    if (!job) return i === 0 ? null : SKIP;
    const current = isCurrent(job.end);
    const start = gradParts(job.start);
    const end = current ? null : gradParts(job.end);
    if (f.kind === "checkbox") return /current|present|still|i work here|currently/.test(l) ? (current ? "yes" : SKIP) : SKIP;
    if (/\b(start|from)\b/.test(l)) return /month/.test(l) ? month(start) : /year/.test(l) ? (start ? String(start.year) : null) : job.start ?? null;
    if (/\b(end|to|until)\b/.test(l)) {
      if (current) return SKIP;
      return /month/.test(l) ? month(end) : /year/.test(l) ? (end ? String(end.year) : null) : job.end ?? null;
    }
    if (/company|employer|organi[sz]ation|business name/.test(l)) return job.company;
    if (/title|position|role/.test(l)) return job.title;
    if (/location|city/.test(l)) return job.location ?? null;
    if (/description|responsibilit|summary|duties|achievement/.test(l)) return (job.bullets ?? []).join(" ").slice(0, 1500) || null;
    return null;
  }
  const edu = a.education?.[i];
  if (!edu) return i === 0 ? null : SKIP;
  const grad = gradParts(edu.graduation ?? (i === 0 ? a.graduation_date : null));
  if (/\b(start|from)\b/.test(l)) {
    if (!grad) return null;
    return /month/.test(l) ? month({ monthName: "August" }) : /year/.test(l) ? String(grad.year - degreeYears(edu.degree)) : null;
  }
  if (/\b(end|to|graduat|completion)\b/.test(l)) return /month/.test(l) ? month(grad) : /year/.test(l) && grad ? String(grad.year) : null;
  if (/school|university|college|institution/.test(l)) return edu.school ?? (i === 0 ? a.school ?? null : null);
  if (/\bdegree\b/.test(l)) {
    if (!edu.degree) return null;
    const choices = degreeChoices(edu.degree);
    if (f.options.length && f.kind !== "combobox") return choices.map((c) => pickOption(c, f.options)).find(Boolean) ?? null;
    return choices.join(ALT);
  }
  if (/discipline|field of study|major|area of study|concentration/.test(l)) {
    if (!edu.field) return null;
    const choices = disciplineChoices(edu.field);
    if (f.options.length && f.kind !== "combobox") return choices.map((c) => pickOption(c, f.options)).find(Boolean) ?? null;
    return choices.join(ALT);
  }
  if (/\bgpa\b|grade point/.test(l)) return edu.gpa ?? (i === 0 ? a.gpa ?? null : null) ?? SKIP;
  return null;
}

/**
 * "Which of these languages / tools are you proficient in? (select all)": every listed option that is on the
 * resume's skills (Python, Java, JavaScript…), else the "none" option. Not spoken languages.
 */
export function skillOptions(f: Field, a: Applicant): string | null {
  if (f.kind !== "checkboxes" || !f.options.length || !a.skills?.length) return null;
  const l = f.label.toLowerCase();
  if (!/(proficien|experience (with|in|using)|familiar|skills?\b|programming|languages?|technolog|tools?\b|frameworks?|platforms?|stack)/.test(l)) return null;
  if (/(speak|spoken|fluent|written|native|bilingual)/.test(l)) return null;
  const norm = (x: string) => x.toLowerCase().replace(/\.js\b/g, "js").replace(/[^a-z0-9+#]+/g, " ").trim();
  const mine = a.skills.map(norm);
  const hits = f.options.filter((o) => {
    const n = norm(o);
    return n && !/^(none|other|n a)\b/.test(n) && mine.some((m) => m === n || m.split(/\s*\/\s*| /).includes(n) || (n.length > 3 && m.includes(n)));
  });
  if (hits.length) return hits.join(", ");
  return f.options.find((o) => /^none\b/i.test(o)) ?? null;
}

/**
 * Security clearance questions for someone who holds none (saved answer "Eligible / willing to obtain").
 * The saved answer only fits "are you willing / eligible to obtain one?" — reusing it elsewhere answered
 * "Yes" to "Have you ever held a clearance?" and to "…ever had a clearance suspended, denied or revoked?".
 */
export function clearanceAnswer(f: Field, a: Applicant): string | null {
  const l = f.label.toLowerCase();
  if (!/clearance|polygraph|security access/.test(l)) return null;
  const saved = a.answers?.security_clearance ?? "";
  const holdsOne = /(secret|ts\/sci|public trust|confidential|\bq\b|\bl\b clearance|dod)/i.test(saved) && !/(willing|eligible|obtain|none|no\b)/i.test(saved);
  if (holdsOne) return null; // the applicant's own answer decides
  const none = () => (f.options.length ? (f.options.find((o) => /^none\b|no clearance|^n\/?a\b|not applicable|never (held|had)|do not (hold|have)|^no\b/i.test(o)) ?? null) : "None");
  const choice = f.kind === "select" || f.kind === "radio" || f.kind === "combobox" || f.options.length > 0;
  if (/(suspend|denied|revok|debar|terminat)/.test(l)) return yesNo(f, false);
  if (/polygraph/.test(l)) return choice ? (none() ?? yesNo(f, false)) : "No";
  if (/(willing|able|eligible|obtain|consent|agree|pass|qualify)/.test(l) && !/(held|hold|currently have|possess)/.test(l)) return null; // the saved answer / AI handle these
  if (/(highest|what|which|type|level|kind).{0,30}clearance/.test(l)) return choice ? none() : "None";
  if (/(ever|currently|active|held|hold|have|possess|obtained).{0,60}clearance|clearance.{0,30}(held|hold|active|obtained)/.test(l)) return choice ? yesNo(f, false) : "No";
  return null;
}

/** Answers we know without asking the AI (free). */
export function knownValue(f: Field, a: Applicant): string | null {
  const fromResume = sectionValue(f, a);
  if (fromResume !== undefined) return fromResume;
  const l = f.label.toLowerCase();
  const clearance = clearanceAnswer(f, a);
  if (clearance) return clearance;
  const skillPick = skillOptions(f, a);
  if (skillPick) return skillPick;
  // A required cover letter gets one written for this job (opts.coverLetter); optional ones are left empty.
  if (f.kind === "file") return /cover/.test(l) ? (f.required ? "__COVER__" : null) : /resume|cv|attach/.test(l) || f.required ? "__RESUME__" : null;
  if (/password/.test(l)) return a.portal?.password ?? null;
  // "By entering today's date I acknowledge…" / signature date: today's date.
  if (/today.?s date|enter (the|today.?s|current) date|date of (signature|acknowledg)|signature date|^date\b|\bdate signed\b/.test(l) && f.kind !== "checkbox" && f.kind !== "radio") {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  }
  // "Please type your name to electronically sign this document" / e-signature: the full name.
  if (/(type|enter|print) your (full |legal )?name|electronically sign|e-?signature|digital signature|^signature/.test(l) && f.kind !== "checkbox" && f.kind !== "radio")
    return `${a.first_name} ${a.last_name}`;
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
  // "Please provide a link to your GitHub profile, portfolio, personal website, or a demonstration of your work":
  // a request for a link (not a yes/no about having one) → the best link the applicant has.
  if ((f.kind === "text" || f.kind === "textarea") && /\b(link|url|urls)\b/.test(l) && /(github|portfolio|website|personal site|work samples?|demonstration|projects?)/.test(l) && !/\b(do you|have you|are you)\b/.test(l))
    return a.website_url ?? a.github_url ?? a.linkedin_url ?? null;
  // Your own address (never one copied from the employer's page): street from Profile → Common questions + city/state/ZIP.
  if ((f.kind === "text" || f.kind === "textarea") && /\b(physical|home|permanent|current|mailing|residential|street)? ?address\b/.test(l) && !/e-?mail|ip address|company|employer|office|work address|web/.test(l)) {
    const street = a.answers?.address;
    const cityLine = [a.city, [a.state, a.answers?.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    if (/street|line 1/.test(l)) return street ?? null;
    if (/city.{0,20}(state|zip)/.test(l) && cityLine) return cityLine;
    return [street, cityLine].filter(Boolean).join(", ") || null;
  }
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
  // Education section fields (Greenhouse: Degree / Discipline / Start & End date month + year).
  const edu = a.education?.[0];
  const isQuestion = /\?|\b(do you|have you|are you|will you|did you|what is your highest)\b/.test(l);
  if (!isQuestion && edu) {
    const grad = gradParts(edu.graduation ?? a.graduation_date);
    if (/\bdegree\b/.test(l) && !/year|date|month/.test(l) && edu.degree) return f.options.length ? pickOption(edu.degree, f.options) ?? edu.degree : edu.degree;
    if (/discipline|field of study|\bmajor\b|area of study/.test(l) && edu.field) return f.options.length ? pickOption(edu.field, f.options) ?? edu.field : edu.field;
    if (grad && /(end|graduation|completion|to)\b.{0,12}\b(date )?year|^year\b.{0,10}(end|graduat)/.test(l)) return String(grad.year);
    if (grad && /(end|graduation|completion|to)\b.{0,12}\b(date )?month/.test(l)) return grad.monthName;
    if (grad && /(start|from)\b.{0,12}\b(date )?year/.test(l)) return String(grad.year - (/master|m\.?s\b/i.test(edu.degree ?? "") ? 2 : 4));
    if (grad && /(start|from)\b.{0,12}\b(date )?month/.test(l)) return "August";
  }
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
  if (value === SKIP) return;
  if (value.includes(ALT)) {
    const choices = value.split(ALT).filter(Boolean);
    if (f.kind === "combobox") return pickFromSearch(page, sel, choices);
    value = (f.options.length ? choices.map((c) => pickOption(c, f.options)).find(Boolean) : null) ?? choices[0];
  }
  switch (f.kind) {
    case "file":
      // The resume never goes into a cover-letter slot (a required one gets a written letter instead).
      if (/cover/i.test(f.label)) return;
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
      // Pick the option whose text IS the answer — a "contains" match chose "Female" for "Male".
      const choose = async (): Promise<boolean> => {
        const list = await page.getAttribute(sel, "aria-controls").catch(() => null);
        const scope = list ? `[id="${list}"] ` : "";
        const loc = page.locator(`${scope}[role=option], ${scope}[class*='select__option']`);
        const texts = await loc
          .evaluateAll((els) => els.map((e) => ((e as HTMLElement).offsetParent !== null ? (e.textContent ?? "").replace(/\s+/g, " ").trim() : "")))
          .catch(() => [] as string[]);
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        let idx = texts.findIndex((t) => t && norm(t) === norm(value));
        if (idx < 0) {
          const hit = pickOption(value, texts.filter(Boolean));
          idx = hit ? texts.indexOf(hit) : -1;
        }
        if (idx < 0) return false;
        await loc.nth(idx).click().catch(() => {});
        return true;
      };
      await page.click(sel);
      await page.waitForTimeout(400);
      if (await choose()) return;
      const tag = await page.evaluate((s2) => document.querySelector(s2)?.tagName ?? "", sel);
      if (tag === "INPUT") await page.fill(sel, value).catch(() => page.keyboard.type(value));
      else await page.keyboard.type(value, { delay: 30 });
      await page.waitForTimeout(800);
      if (await choose()) return;
      // Free-text search box (cities, schools): take the site's suggestion only when there is exactly one.
      const shown = await page.locator("[role=option]:visible, [class*='select__option']:visible").count().catch(() => 0);
      if (shown >= 1) await page.keyboard.press("Enter");
      return;
    }
  }
}

/** After a resume upload, sites parse it and re-render the form. Wait until the form stops changing. */
/**
 * Search-and-pick box (Greenhouse School / Degree / Discipline): type each choice until the list offers a
 * real match, and pick it. Lists are long and only partly rendered, so typing is what finds the option.
 */
async function pickFromSearch(page: Page, sel: string, choices: string[]) {
  const words = (s: string) => straight(s).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
  for (const choice of choices) {
    await page.click(sel).catch(() => {});
    await page.fill(sel, "").catch(() => {});
    await page.keyboard.type(choice, { delay: 25 });
    await page.waitForTimeout(900);
    const list = await page.getAttribute(sel, "aria-controls").catch(() => null);
    const scope = list ? `[id="${list}"] ` : "";
    const opts = await page
      .locator(`${scope}[role=option]`)
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()))
      .catch(() => [] as string[]);
    const want = words(choice);
    // An option that contains every meaningful word of the choice ("Master's Degree" ↔ "Master's Degree (M.S.)").
    const idx = opts.findIndex((o) => !/no (results|options)|not found/i.test(o) && want.every((w) => straight(o).toLowerCase().includes(w)));
    if (idx >= 0) {
      await page.locator(`${scope}[role=option]`).filter({ hasText: opts[idx] }).first().click().catch(async () => page.keyboard.press("Enter"));
      await page.waitForTimeout(250);
      return;
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  // Nothing matched cleanly: type the first choice and take the site's top suggestion.
  await page.click(sel).catch(() => {});
  await page.fill(sel, "").catch(() => {});
  await page.keyboard.type(choices[0], { delay: 25 });
  await page.waitForTimeout(900);
  await page.keyboard.press("Enter").catch(() => {});
}

/**
 * Greenhouse lists one Employment / Education block; "Add another" adds more. Add enough for every job and
 * degree on the resume (max 3 each) so the application shows the full history, not just the latest entry.
 */
export async function expandResumeBlocks(page: Page, a: Applicant) {
  for (const [kind, want] of [
    ["employment", Math.min(3, a.experience?.length ?? 0)],
    ["education", Math.min(3, a.education?.length ?? 0)],
  ] as const) {
    for (let guard = 0; guard < 3; guard++) {
      const counts = await page
        .evaluate((k) => {
          const forms = document.querySelectorAll(k === "employment" ? "[class*=employment-form], [class*=employment--form]" : "[class*=education--form], [class*=education-form]").length;
          const container = document.querySelector(`[class*=${k}--container], [class*=${k}-container]`);
          const add = container ? Array.from(container.querySelectorAll("button")).find((b) => /add another/i.test(b.textContent ?? "")) : null;
          if (add) add.setAttribute("data-9to5-add", k);
          return { forms, add: Boolean(add) };
        }, kind)
        .catch(() => ({ forms: 0, add: false }));
      if (!counts.forms || !counts.add || counts.forms >= want) break;
      await page.click(`[data-9to5-add="${kind}"]`).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "May 2027" / "2027-05" / "05/2027" / "2027" → { year, monthName } (month defaults to May). */
export function gradParts(s: string | null | undefined): { year: number; monthName: string } | null {
  if (!s) return null;
  const year = Number(s.match(/(19|20)\d\d/)?.[0]);
  if (!year) return null;
  const named = MONTHS.findIndex((m) => new RegExp(m.slice(0, 3), "i").test(s));
  const num = s.match(/(?:^|[^\d])(1[0-2]|0?[1-9])[/-](?:19|20)\d\d|(?:19|20)\d\d-(1[0-2]|0?[1-9])/); // "12" before "1"
  const idx = named >= 0 ? named : num ? Number(num[1] ?? num[2]) - 1 : 4;
  return { year, monthName: MONTHS[idx] };
}

/** Close a cookie banner that would cover the Submit button (declines optional cookies when it can). */
async function dismissCookies(page: Page) {
  for (const t of ["Decline all", "Reject all", "Decline optional cookies", "Reject", "Decline", "Accept all", "Accept", "Got it", "I agree"]) {
    const b = page.locator(`button:text-is("${t}"), a[role=button]:text-is("${t}")`).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      return;
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

/** A dropdown's placeholder text — never an answer (the memory had learned "Select One" for a clearance question). */
export const PLACEHOLDER = /^\s*(select( one| an option)?|choose( one| an option)?|please select|--+|n\/a - select)\s*\.{0,3}\s*$/i;

/** True when the options list is the whole set of choices (not the first page of a search-as-you-type box). */
function optionsAreComplete(f: Field): boolean {
  if (!f.options.length) return false;
  if (f.kind === "select" || f.kind === "radio" || f.kind === "checkboxes") return true;
  // Comboboxes: a short list is the full list; a long one (schools, cities) is searched by typing.
  return f.kind === "combobox" && f.options.length < 40 && !/school|university|college|city|location|country|state|discipline|major|field of study/i.test(f.label);
}

/**
 * Should the AI's answer be reused on other applications? Not when it is about this job or employer
 * ("Company name" → Samsung, "Physical Address" → Samsung's office), a resume block, or a contact detail.
 */
export function worthRemembering(label: string, answer: string, opts: { company: string; jobTitle: string }): boolean {
  const l = label.toLowerCase();
  const v = answer.toLowerCase();
  if (PLACEHOLDER.test(answer)) return false;
  if (/^(employment|education) \d+ — /.test(l)) return false;
  if (/^(title|job title|company( name)?|employer|start date|end date|degree|school|discipline|address|physical address|street|location|city|current (title|employer)|position)\b/.test(l.replace(/[^a-z ]+/g, " ").trim())) return false;
  if (/address|zip|postal/.test(l)) return false;
  const company = opts.company.toLowerCase().replace(/,? (inc|llc|corp|corporation|ltd|co)\.?$/, "").trim();
  if (company.length > 2 && v.includes(company)) return false;
  if (opts.jobTitle && v.includes(opts.jobTitle.toLowerCase())) return false;
  return true;
}

/**
 * Drop remembered answers that must never be reused: placeholders ("Select One"), resume-block fields and
 * addresses learned from one employer's form ("company name" → Samsung, "physical address" → Samsung's office).
 */
export function cleanMemory(memory: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(memory ?? {})) {
    if (typeof v !== "string" || !k.trim() || !v.trim() || PLACEHOLDER.test(v)) continue;
    if (/^(title|job title|company name|company|employer|start date (month|year)|end date (month|year)|degree|school|discipline|position)$/.test(k)) continue;
    if (/address|zip code|postal/.test(k)) continue;
    if (/clearance|polygraph/.test(k)) continue; // answered by the clearance rules, never a remembered guess
    out[k] = v;
  }
  return out;
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
      let v = opts.forceAi?.(f) ? null : knownValue(f, opts.applicant);
      // A saved / remembered answer that isn't one of this question's choices ("Eligible / willing to obtain"
      // for a clearance list, a remembered "Select One") would leave it empty: ask the AI with the real options.
      if (v && v !== SKIP && !v.includes(ALT) && !f.section && optionsAreComplete(f)) {
        const hit = f.kind === "checkboxes" ? v.split(/\s*[,;|]\s*/).map((x) => pickOption(x, f.options)).filter(Boolean).join(", ") : pickOption(v, f.options);
        v = hit || null;
      }
      if (v) answers[f.id] = v;
      // Resume blocks (Employment / Education) come only from the resume — never the AI, which put the
      // employer being applied to ("Samsung") into Company name.
      else if (!f.section) unknown.push(f);
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
        jobs: (opts.applicant.experience ?? []).map((e) => `${e.title} @ ${e.company}${e.location ? `, ${e.location}` : ""} (${e.start ?? "?"} – ${e.end ?? "?"})`),
        education: (opts.applicant.education ?? []).map((e) => `${e.degree ?? ""} in ${e.field ?? "?"}, ${e.school ?? "?"} (graduation ${e.graduation ?? "?"})`),
        skills: (opts.applicant.skills ?? []).slice(0, 60),
        links: { linkedin: opts.applicant.linkedin_url, github: opts.applicant.github_url, website: opts.applicant.website_url },
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
          if (v != null && String(v).trim() && !PLACEHOLDER.test(String(v))) {
            answers[f.id] = String(v);
            if (f.kind !== "checkbox" && worthRemembering(f.label, String(v), opts)) learned.push({ label: f.label, answer: String(v) });
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
    await dismissCookies(page);
    const resumeInput = page.locator("input[type=file]").first();
    if ((await resumeInput.count()) && opts.resumePath) {
      await resumeInput.setInputFiles(opts.resumePath).catch(() => {});
      await waitForFormToSettle(page);
    }
    tick("resume uploaded");
    await expandResumeBlocks(page, opts.applicant);
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
      if (v === "__COVER__") {
        const path = await opts.coverLetter?.().catch(() => null);
        if (path) await page.setInputFiles(`[data-9to5="${f.id}"]`, path).catch(() => {});
        continue;
      }
      await fill(page, f, v === "__RESUME__" ? "" : v, opts.resumePath).catch(() => {});
      if (Date.now() - tf > 4000) tick(`slow fill (${Math.round((Date.now() - tf) / 1000)}s): ${f.kind} ${f.label.slice(0, 60)}`);
    }
    tick("filled");
    await page.waitForTimeout(1500);

    // Follow-up questions appear only after an answer (Greenhouse shows "Please identify your race" once
    // "Are you Hispanic/Latino?" is answered). Look again and answer the new ones, up to twice.
    for (let pass = 0; pass < 2; pass++) {
      const seen = new Set(fields.map((f) => `${f.kind}|${f.label}`));
      const extra = (await collectFields(page)).filter((f) => !seen.has(`${f.kind}|${f.label}`) && !f.filled && f.kind !== "file");
      if (!extra.length) break;
      await readComboboxOptions(page, extra);
      const more = await answerFields(db, extra, opts);
      aiCalls += more.aiCalls;
      learned.push(...more.learned);
      for (const f of extra) {
        const v = more.answers[f.id];
        if (v) await fill(page, f, v, opts.resumePath).catch(() => {});
      }
      tick(`answered ${extra.filter((f) => more.answers[f.id]).length}/${extra.length} follow-up question(s)`);
      if (more.quota) break;
      await page.waitForTimeout(1000);
    }

    // Safety net: an answered box that is still empty on the page (some year / search boxes ignore a
    // programmatic fill) gets the answer typed again like a person — click, type, Enter/Tab.
    let retyped = 0;
    for (const f of fields) {
      const v = answers[f.id];
      if (!v || v.startsWith("__") || v.includes(ALT) || (f.kind !== "text" && f.kind !== "combobox")) continue;
      const sel = `[data-9to5="${f.id}"]`;
      const empty = await page
        .locator(sel)
        .evaluate((e) => {
          const own = ((e as HTMLInputElement).value ?? "").trim();
          if (own) return false;
          // A picked dropdown value is shown next to the (empty) search input, e.g. react-select's
          // "select__single-value" — look in the control around the input, not at the input itself.
          for (let a = e.parentElement, d = 0; a && d < 5; a = a.parentElement, d++)
            if (a.querySelector("[class*=single-value], [class*=multi-value], [class*=singleValue], [class*=multiValue]")) return false;
          const control = e.closest("[class*=select__control], [class*=-control], [role=group]") ?? e.parentElement?.parentElement;
          const shown = (control?.textContent ?? "").replace(/select\.{3}|search|type to search|no options/gi, "").trim();
          return !shown;
        })
        .catch(() => false);
      if (!empty) continue;
      if (f.kind === "combobox") await fill(page, f, v, opts.resumePath).catch(() => {});
      else {
        await page.click(sel).catch(() => {});
        await page.keyboard.press("Control+A").catch(() => {});
        await page.keyboard.type(v, { delay: 40 });
        await page.waitForTimeout(700);
        await page.keyboard.press("Tab").catch(() => {});
      }
      retyped++;
    }
    if (retyped) tick(`retyped ${retyped} answer(s) the page hadn't kept`);
    await dismissCookies(page);

    if (await captchaVisible(page)) return { status: "needs_user", detail: "Site shows a CAPTCHA — please submit this one yourself", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    if (opts.dryRun) return { status: "needs_user", detail: "Dry run: form filled but not submitted", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };

    const submit = page.locator("button[type=submit], input[type=submit], button:has-text('Submit application'), button:has-text('Submit')").last();
    if ((await submit.count()) === 0) return { status: "needs_user", detail: "Couldn't find the Submit button", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls };
    const submittedAt = new Date();
    await submit.click();
    await page.waitForTimeout(6000);

    // Some sites (Greenhouse especially) email a security code after Submit and wait for it.
    const code = await enterEmailCode(page, opts.emailCode && ((since: Date) => opts.emailCode!(since, opts.company)), submittedAt);
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
    // The fields the page itself marks invalid, by their question — not question text that merely says "please provide…".
    const invalid = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("[aria-invalid=true]"))
          .filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0)
          .map((e) => {
            const id = e.getAttribute("id");
            const lab = (id && document.querySelector(`label[for="${id}"]`)) || e.closest("label, fieldset, [class*=field i], [class*=question i]")?.querySelector("label, legend");
            return (lab?.textContent ?? e.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").replace(/\*/g, "").trim().slice(0, 80);
          })
          .filter(Boolean)
      )
      .catch(() => [] as string[]);
    // Error messages the page shows next to fields (red helper text / alerts), with the question they belong to.
    const shownErrors = invalid.length
      ? []
      : await page
          .evaluate(() =>
            Array.from(document.querySelectorAll("[role=alert], [class*=error i], [class*=invalid i], [id*=error i]"))
              .filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0 && !e.querySelector("input, select, textarea") && (e.textContent ?? "").trim().length > 2)
              .map((e) => {
                const q = e.closest("[class*=field i], [class*=question i], fieldset")?.querySelector("label, legend")?.textContent ?? "";
                return `${q.replace(/\s+/g, " ").replace(/\*/g, "").trim().slice(0, 70)}${q ? ": " : ""}${(e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}`;
              })
          )
          .catch(() => [] as string[]);
    const err = invalid.length
      ? `needs ${[...new Set(invalid)].slice(0, 3).join("; ")}`
      : shownErrors.length
        ? [...new Set(shownErrors)].slice(0, 3).join("; ")
        : after.match(/(your form needs corrections[^.]{0,40}|missing entry for required field:?[^.?]{0,120}|this field is required|(field|question|answer) is required|please (enter|fill in|complete|provide)[^.]{0,80}|(is )?invalid (email|phone|format|value)[^.]{0,40})/i)?.[0];
    // The rejected fields as full questions (text + choices), so the user can answer them once on the Needs-you page.
    const rejectedLabels = invalid.length ? invalid : shownErrors.map((x) => x.split(": ")[0]).filter(Boolean);
    const pending = questionsFor(rejectedLabels, fields);
    return { status: "needs_user", detail: err ? `Form rejected: ${err}` : "Submitted but no confirmation seen — please check", answers: labelled(fields, answers), learned, usedPortalLogin, aiCalls, pending: pending.length ? pending : undefined };
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
  if (n > 1 && n >= code.length) {
    // One box per character (Greenhouse: 8 boxes). Type the whole code from the first box so the site
    // moves focus itself — filling box by box lost a character and left Submit disabled.
    await boxes.first().click().catch(() => {});
    await page.keyboard.type(code, { delay: 90 });
    await page.waitForTimeout(300);
    const got = await boxes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join(""));
    if (got.length < code.length) for (let i = 0; i < code.length; i++) await boxes.nth(i).fill(code[i]).catch(() => {});
  } else await boxes.first().fill(code);
  await page.waitForTimeout(500);
  const again = page.locator("button[type=submit], input[type=submit], button:has-text('Submit'), button:has-text('Verify')").last();
  if (await again.count()) await again.click().catch(() => {});
  await page.waitForTimeout(6000);
  return "entered";
}

/**
 * The full questions (text, kind, choices) behind a list of labels the site complained about, so the user
 * sees exactly what to answer instead of just "needs End date year". Labels with no matching field still show.
 */
export function questionsFor(labels: string[], fields: Field[]): PendingQuestion[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out: PendingQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const l = norm(raw);
    if (!l || seen.has(l)) continue;
    seen.add(l);
    const f = fields.find((x) => x.kind !== "file" && (norm(x.label) === l || norm(x.label).includes(l) || l.includes(norm(x.label).slice(0, 40))));
    out.push({
      key: memoryKey(f?.label ?? raw),
      label: f?.label ?? raw,
      kind: f?.kind ?? "text",
      options: f ? (f.kind === "checkbox" ? ["Yes", "No"] : f.options.slice(0, 60)) : [],
      required: true,
    });
  }
  return out;
}

/** Answers keyed by the question text (what the user sees), not internal field ids. */
export function labelled(fields: Field[], answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = answers[f.id];
    if (!v || v === SKIP || f.kind === "file" || /password/i.test(f.label)) continue;
    out[f.label || f.id] = v.split(ALT)[0];
  }
  return out;
}
