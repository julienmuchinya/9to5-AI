/**
 * Resume blocks (Greenhouse Employment / Education), answer memory hygiene and skill checklists —
 * regressions from real applications (Samsung, IMC, Hearst, Draper, Two Six, Elevation Autism Center).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { ALT, SKIP, cleanMemory, collectFields, knownValue, sectionValue, skillOptions, worthRemembering, type Applicant, type Field } from "./apply";
import { commonSenseAnswer } from "../../src/lib/v2/app-questions";

const me: Applicant = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "j@example.com",
  city: "Atlanta",
  state: "Georgia",
  github_url: "https://github.com/x",
  resume_text: "",
  answers: { address: "12 Example Lane", zip: "30301" },
  skills: ["Python", "Java", "JavaScript", "React", "Node.js", "AWS"],
  experience: [
    { title: "Junior Data Engineer", company: "Acme Labs", start: "January 2025", end: "Present", location: "Remote", bullets: ["Improved accuracy"] },
    { title: "Software Engineer", company: "Widget Co", start: "Jan 2023", end: "Dec 2025" },
  ],
  education: [
    { school: "Example State University", degree: "Bachelor’s Degree", field: "Software Engineering", graduation: "Dec 2026" },
    { school: "Example State University", degree: "Master’s Degree", field: "Electrical and Computer Engineering", graduation: "Dec 2028" },
  ],
};
const field = (label: string, extra: Partial<Field> = {}): Field => ({ id: "f1", label, kind: "text", required: true, options: [], ...extra });

describe("Employment / Education blocks come from the resume", () => {
  it("fills each employment block from the matching job, never the hiring company", () => {
    const e = (label: string, index: number, kind: Field["kind"] = "text") => sectionValue(field(`Employment ${index + 1} — ${label}`, { section: "employment", index, kind }), me);
    expect(e("Company name*", 0)).toBe("Acme Labs");
    expect(e("Title*", 0)).toBe("Junior Data Engineer");
    expect(e("Start date month*", 0, "combobox")).toBe("January");
    expect(e("Start date year*", 0)).toBe("2025");
    // Current job: end date left empty, "Current role" ticked (a future end date made Greenhouse reject the form).
    expect(e("End date year*", 0)).toBe(SKIP);
    expect(e("Current role", 0, "checkbox")).toBe("yes");
    expect(e("Company name*", 1)).toBe("Widget Co");
    expect(e("End date month*", 1, "combobox")).toBe("December");
    expect(e("End date year*", 1)).toBe("2025");
    expect(e("Current role", 1, "checkbox")).toBe(SKIP);
  });

  it("fills each education block from the matching degree, with picker fallbacks", () => {
    const d = (label: string, index: number, kind: Field["kind"] = "combobox") => sectionValue(field(`Education ${index + 1} — ${label}`, { section: "education", index, kind }), me);
    expect(d("School*", 0)).toBe("Example State University");
    expect(d("Degree*", 0)?.split(ALT)[0]).toBe("Bachelor's Degree");
    expect(d("Discipline*", 0)?.split(ALT)).toContain("Computer Science");
    expect(d("End date year*", 0, "text")).toBe("2026");
    expect(d("Start date year*", 0, "text")).toBe("2022");
    expect(d("Degree*", 1)?.split(ALT)[0]).toBe("Master's Degree");
    expect(d("Discipline*", 1)?.split(ALT)).toContain("Computer Engineering");
    expect(d("End date month*", 1)).toBe("December");
  });

  it("is not used outside a resume block", () => {
    expect(sectionValue(field("Company name"), me)).toBeUndefined();
  });
});

describe("known answers", () => {
  it("uses the applicant's own address, not one copied from the employer", () => {
    expect(knownValue(field("Physical Address*"), me)).toBe("12 Example Lane, Atlanta, Georgia 30301");
    expect(knownValue(field("Please provide your permanent address (city, state, zip code)"), me)).toBe("Atlanta, Georgia 30301");
    expect(knownValue(field("Email address"), me)).not.toMatch(/Example Lane/);
  });

  it("answers a request for a GitHub / portfolio link", () => {
    expect(knownValue(field("Please provide a link to your GitHub profile, portfolio, personal website, or a demonstration of your work."), me)).toBe("https://github.com/x");
  });

  it("ticks every listed skill on the resume", () => {
    const f = field("Please indicate which of the following programming languages you are proficient in (select all that apply):", { kind: "checkboxes", options: ["Java", "C++", "Python", "None of the above"] });
    expect(skillOptions(f, me)).toBe("Java, Python");
    const none = field("Which tools have you used?", { kind: "checkboxes", options: ["Verilog", "SystemC", "None"] });
    expect(skillOptions(none, me)).toBe("None");
    expect(skillOptions(field("Which languages do you speak fluently?", { kind: "checkboxes", options: ["French", "Python"] }), me)).toBeNull();
  });

  it("answers 'have you worked for X in the past? if so…' with No", () => {
    expect(commonSenseAnswer("Have you worked for Two Six Technologies or an affiliate in the past? If so, please provide the name of the team you supported and dates of employment.", [], "text")).toBe("No");
  });
});

describe("security clearance (applicant holds none, willing to obtain)", () => {
  const who: Applicant = { ...me, answers: { ...me.answers, security_clearance: "Eligible / willing to obtain" } };
  const yn = ["Select One", "Yes", "No"];
  const q = (label: string, options = yn, kind: Field["kind"] = "combobox") => knownValue(field(label, { kind, options }), who);
  it("never claims a clearance it doesn't have (Draper)", () => {
    expect(q("Have you ever held an active security clearance issued by the US Department of Defense, or any other federal agency?*")).toBe("No");
    expect(q("To your knowledge, have you ever had a security clearance/access suspended, denied, or revoked; or been debarred from government employment?*")).toBe("No");
    expect(q("What is the highest level of clearance do/did you actively utilize?*", ["Select One", "None", "Confidential", "Secret", "Top Secret", "TS/SCI", "Other"])).toBe("None");
    expect(q("Have you held an active security clearance in the last 24 months?", [], "text")).toBe("No");
    expect(q("Have you had a successfully adjudicated polygraph?*", ["Select One", "None", "CI Poly", "Full Scope Poly", "Lifestyle Poly"])).toBe("None");
  });
  it("leaves 'willing to obtain' questions to the saved answer", () => {
    expect(knownValue(field("Are you willing and eligible to obtain a security clearance?", { kind: "radio", options: ["Yes", "No"] }), who)).toBe("Yes");
  });
});

describe("answer memory", () => {
  const job = { company: "Samsung", jobTitle: "Power-Thermal Simulation Software Engineer Intern" };
  it("never remembers job-specific or resume-block answers", () => {
    expect(worthRemembering("Company name", "Samsung", job)).toBe(false);
    expect(worthRemembering("Title", "Power-Thermal Simulation Software Engineer Intern", job)).toBe(false);
    expect(worthRemembering("Physical Address", "1 Samsung Way, Austin, TX", job)).toBe(false);
    expect(worthRemembering("Employment 1 — Start date year", "2026", job)).toBe(false);
    expect(worthRemembering("What is the highest level of clearance do/did you actively utilize?", "Select One", job)).toBe(false);
    expect(worthRemembering("Are you able to work onsite?", "Yes", job)).toBe(true);
  });

  it("drops polluted entries already stored", () => {
    const m = cleanMemory({
      "company name": "Samsung",
      title: "Power-Thermal Simulation Software Engineer Intern",
      "physical address": "Samsung Electronics America, 1 Samsung Way",
      "end date year": "2029",
      "what is the highest level of clearance do did you actively utilize": "Select One",
      "do you currently have any offers": "No",
    });
    expect(m).toEqual({ "do you currently have any offers": "No" });
  });
});

describe("reading Greenhouse resume blocks", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.addInitScript("globalThis.__name = globalThis.__name || function (f) { return f; };");
    page = await ctx.newPage();
  }, 60_000);
  afterAll(async () => browser?.close());

  it("names fields by block and the upload slots by their group", async () => {
    await page.setContent(`<!doctype html><html><body><form>
      <div class="file-upload"><div class="label upload-label">Resume/CV*</div><label for="resume">Attach</label><input id="resume" type="file"></div>
      <div class="file-upload"><div class="label upload-label">Cover Letter</div><label for="cover_letter">Attach</label><input id="cover_letter" type="file"></div>
      <div class="employment--container">
        <div class="employment-form"><label for="company-name-0">Company name*</label><input id="company-name-0" type="text">
          <label for="end-date-year-0">End date year*</label><input id="end-date-year-0" type="text"></div>
        <div class="employment-form"><label for="company-name-1">Company name*</label><input id="company-name-1" type="text"></div>
      </div>
      <div class="education--container"><div class="education--form"><label for="end-year--0">End date year*</label><input id="end-year--0" type="number"></div></div>
    </form></body></html>`);
    const f = await collectFields(page);
    const labels = f.map((x) => x.label);
    expect(labels).toContain("Employment 1 — Company name*");
    expect(labels).toContain("Employment 2 — Company name*");
    expect(labels).toContain("Employment 1 — End date year*");
    expect(labels).toContain("Education 1 — End date year*");
    const files = f.filter((x) => x.kind === "file").map((x) => x.label);
    expect(files.some((l) => /cover letter/i.test(l))).toBe(true);
    // The resume never goes into the cover-letter slot.
    const cover = f.find((x) => x.kind === "file" && /cover/i.test(x.label))!;
    expect(knownValue(cover, me)).toBeNull();
  });
});
