/**
 * Fewer "Needs you" stops, the sensitive-data guard, the 99% budget and the resume rules (default resume,
 * 0–100 match score, tailoring only below 60). Labels below are copied from real forms that went wrong.
 */
import { describe, expect, it } from "vitest";
import { looksLikeSecretValue, scrubFacts, sensitiveField, suspiciousPassword } from "./sensitive";
import { governmentAnswer, knownValue, screenSensitive, SKIP, type Applicant, type Field } from "../../../agent/v2/apply";
import { needsHuman } from "../../../agent/v2/backfill";
import { answerPrompt } from "../../../agent/v2/answer-ai";
import { defaultResumeId, pickResume, rankResumes, resumeMatchScore, TAILOR_BELOW, type ResumeLibrary } from "./resume-library";
import { SAFETY_RATIO, check } from "./freeTier";
import type { ParsedResume } from "./resume";

const applicant: Applicant = {
  first_name: "Sam",
  last_name: "Lee",
  email: "sam@example.com",
  city: "Atlanta",
  state: "GA",
  resume_text: "Software engineer",
  experience: [{ title: "Software Engineer Intern", company: "Acme Corp" }],
  answers: { zip: "30301" },
};
const field = (label: string, kind: Field["kind"] = "combobox", options: string[] = ["Yes", "No"], required = true): Field => ({ id: "f1", label, kind, required, options });

const GOV_CURRENT =
  "Are you a current employee of the U.S. Government (including the U.S. Congress or military) or any state or local government? This includes entities owned or controlled by the U.S. Federal Government, such as the U.S. Postal Service";
const GOV_PAST =
  "Were you an employee of the U.S. Government (including U.S. Congress or military) or any state or local government within the past 10 years? This includes entities owned or controlled by the U.S. Federal Government";

describe("government-employee questions (were answered with the ZIP code)", () => {
  it("answers No from the resume, never the ZIP code", () => {
    expect(knownValue(field(GOV_CURRENT), applicant)).toBe("No");
    expect(knownValue(field(GOV_PAST), applicant)).toBe("No");
    expect(governmentAnswer(field(GOV_PAST, "text", []), applicant)).toBe("No");
  });
  it("leaves it to the AI when the resume shows government work", () => {
    const vet = { ...applicant, experience: [{ title: "Analyst", company: "U.S. Department of Energy" }] };
    expect(governmentAnswer(field(GOV_CURRENT), vet)).toBeNull();
  });
  it("still fills a real ZIP code box", () => {
    expect(knownValue(field("Zip Code", "text", []), applicant)).toBe("30301");
    expect(knownValue(field("Postal code*", "text", []), applicant)).toBe("30301");
  });
});

describe("link questions", () => {
  const withLinks = { ...applicant, github_url: "https://github.com/example" };
  it("an essay that says 'include links' is not answered with a bare URL", () => {
    expect(knownValue(field("Please describe an AI-related project you've worked on, including the tools or models you used. Include links if you can.", "textarea", []), withLinks)).toBeNull();
  });
  it("a plain request for a link still gets one", () => {
    expect(knownValue(field("Please provide a link to your GitHub profile or portfolio", "text", []), withLinks)).toBe("https://github.com/example");
  });
});

describe("sensitive questions", () => {
  it("spots requests for secrets", () => {
    expect(sensitiveField("Social Security Number")?.level).toBe("scam");
    expect(sensitiveField("SSN (for payroll setup)")?.level).toBe("scam");
    expect(sensitiveField("Bank routing number")?.level).toBe("scam");
    expect(sensitiveField("Checking account number for direct deposit")?.level).toBe("scam");
    expect(sensitiveField("Credit card number")?.level).toBe("scam");
    expect(sensitiveField("Passport number")?.level).toBe("scam");
    expect(sensitiveField("Driver's license number")?.level).toBe("scam");
    expect(sensitiveField("Please enter your Gmail password")?.level).toBe("scam");
    expect(sensitiveField("Date of Birth")?.level).toBe("private");
  });
  it("leaves normal questions alone", () => {
    expect(sensitiveField("Do you have a valid driver's license?", "radio")).toBeNull();
    expect(sensitiveField("Are you 18 years of age or older?", "radio")).toBeNull();
    expect(sensitiveField("Email")).toBeNull();
    expect(sensitiveField("We will never ask for your bank account or SSN during the hiring process.", "checkbox")).toBeNull();
    expect(sensitiveField("Phone")).toBeNull();
    expect(sensitiveField(GOV_CURRENT)).toBeNull();
  });
  it("a password box is only OK on a career portal's sign-in", () => {
    expect(suspiciousPassword("Password", "text", "https://jobs.ashbyhq.com/acme/123/application")).toBe(true);
    expect(suspiciousPassword("Password", "text", "https://acme.wd5.myworkdayjobs.com/en-US/External/login")).toBe(false);
  });
  it("stops the whole form on a scam field, before anything is filled", () => {
    const fields = [field("First name", "text", []), field("Social Security Number", "text", [])];
    expect(screenSensitive(fields, "https://boards.greenhouse.io/x/jobs/1").scam).toMatch(/Social Security/);
    const dob = [field("Date of birth", "text", [])];
    expect(screenSensitive(dob, "https://boards.greenhouse.io/x/jobs/1")).toEqual({ scam: null, personal: dob });
  });
  it("never answers or remembers one", () => {
    expect(knownValue(field("Social Security Number", "text", []), { ...applicant, memory: { "social security number": "123-45-6789" } })).toBe(SKIP);
    expect(needsHuman({ key: "ssn", label: "Social Security Number", kind: "text", options: [], required: true })).toBe(true);
  });
  it("keeps secrets out of AI prompts", () => {
    expect(scrubFacts({ zip: "30301", ssn: "123-45-6789", card: "4111 1111 1111 1111", bank_account_number: "x", portal_password: "p" })).toEqual({ zip: "30301" });
    expect(looksLikeSecretValue("123-45-6789")).toBe(true);
    expect(looksLikeSecretValue("30301")).toBe(false);
    const prompt = answerPrompt({ name: "Sam", facts: {}, questions: [], strict: true });
    expect(prompt).toMatch(/NEVER provide/);
    expect(prompt).toMatch(/SECOND TRY/);
  });
});

describe("resume PDFs", () => {
  it("reads a PDF's text without any AI (backup path when Gemini is out)", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const { pdfText } = await import("./pdf-text");
    const d = await PDFDocument.create();
    const page = d.addPage([612, 792]);
    const font = await d.embedFont(StandardFonts.Helvetica);
    page.drawText("Sam Lee", { x: 50, y: 700, size: 14, font });
    page.drawText("Software Engineer Intern at Acme (Python, React)", { x: 50, y: 680, size: 11, font });
    const t = await pdfText(await d.save());
    expect(t).toMatch(/Sam Lee/);
    expect(t).toMatch(/Software Engineer Intern at Acme \(Python, React\)/);
  });
  it("keeps unicode hyphens instead of dropping them", async () => {
    const { winAnsi } = await import("./resume-render");
    expect(winAnsi("Role‑Based multi‐tenant")).toBe("Role-Based multi-tenant");
  });
  it("lays out long education / title lines without overlapping (stacks or shrinks instead)", async () => {
    const { renderClassicResume } = await import("./resume-render");
    const long: ParsedResume = {
      education: [
        { school: "Kennesaw State University", degree: "Master of Science", field: "Electrical and Computer Engineering", graduation: "Expected: Dec 2029", gpa: "3.9" },
        { school: "Kennesaw State University", degree: "Bachelor of Science", field: "Software Engineering", graduation: "Dec 2026", gpa: "3.8" },
      ],
      experience: [{ title: "Junior Prompt Engineer & AI Model Evaluator — Generative AI Quality, Safety & Evaluation", company: "Example AI", start: "Jan 2026", end: "Present", bullets: ["Built things"] }],
      skills: ["Python"],
    };
    expect(await renderClassicResume(long, { name: "Sam Lee" })).not.toBeNull();
  });
});

describe("employer-site jobs", () => {
  it("applies to Greenhouse jobs listed on the employer's own page through Greenhouse's form", async () => {
    const { greenhouseApplyUrl } = await import("./discovery/sources");
    expect(greenhouseApplyUrl("stripe", 8387820, "https://stripe.com/jobs/search?gh_jid=8387820")).toBe("https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8387820");
    expect(greenhouseApplyUrl("acme", 1, "https://job-boards.greenhouse.io/acme/jobs/1")).toBe("https://job-boards.greenhouse.io/acme/jobs/1");
  });
  it("knows which sites need an account before applying", async () => {
    const { needsAccountSite } = await import("../../../agent/v2/resolve-apply");
    expect(needsAccountSite("https://amazon.jobs/en/jobs/123")).toBe(true);
    expect(needsAccountSite("https://careers-acme.icims.com/jobs/1/job")).toBe(true);
    expect(needsAccountSite("https://forge-nano.breezy.hr/p/1/apply")).toBe(false);
  });
});

describe("free-tier budget", () => {
  it("uses 99% of each free limit", () => {
    expect(SAFETY_RATIO).toBe(0.99);
    expect(check(246, 250, "Gemini").allowed).toBe(true);
    expect(check(247, 250, "Gemini").allowed).toBe(false);
  });
});

const sw: ParsedResume = {
  experience: [{ title: "Software Engineer Intern", company: "Acme", bullets: ["Built REST APIs in Python and React with PostgreSQL on AWS", "Wrote Docker CI/CD pipelines"] }],
  skills: ["Python", "React", "PostgreSQL", "AWS", "Docker", "TypeScript"],
  target_roles: ["Software Engineer"],
};
const nurse: ParsedResume = {
  experience: [{ title: "Registered Nurse", company: "City Hospital", bullets: ["Cared for 20 patients per shift in the ICU"] }],
  skills: ["Patient care", "Phlebotomy", "EMR"],
  target_roles: ["Registered Nurse"],
};
const lib = (default_id?: string): ResumeLibrary => ({
  default_id,
  resumes: [
    { id: "main", label: "Software", path: "a", parsed: sw, uploaded_at: "" },
    { id: "b2", label: "Nursing", path: "b", parsed: nurse, uploaded_at: "" },
  ],
});
const SWE_JOB = "Software Engineer\nWe build web apps with Python, React, TypeScript and PostgreSQL on AWS. Docker experience a plus.";

describe("resume library", () => {
  it("scores 0-100 and picks the resume that fits", () => {
    const s = resumeMatchScore(sw, SWE_JOB);
    expect(s).toBeGreaterThanOrEqual(TAILOR_BELOW);
    expect(resumeMatchScore(nurse, SWE_JOB)).toBeLessThan(TAILOR_BELOW);
    expect(pickResume(lib(), SWE_JOB)?.label).toBe("Software");
    expect(pickResume(lib(), "Registered Nurse\nICU patient care, phlebotomy, EMR charting")?.label).toBe("Nursing");
  });
  it("the default resume wins near-ties and jobs with nothing to go on", () => {
    expect(defaultResumeId(lib())).toBe("main");
    expect(defaultResumeId(lib("b2"))).toBe("b2");
    expect(defaultResumeId(lib("gone"))).toBe("main");
    expect(rankResumes(lib("b2"), "Team member\n")[0].entry.id).toBe("b2");
  });
});
