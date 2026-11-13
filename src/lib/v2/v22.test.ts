import { describe, expect, it } from "vitest";
import { freshness, planQueue, priorityScore, companyKey, ago, COMPANY_DAILY_CAP } from "./priority";
import { answerFromProfile, customStore, findSimilarAnswer, isJobSpecific, memoryKey, pickOption, questionFor, rememberAnswers } from "./app-questions";
import { nextScheduledRun } from "./dispatch";
import { knownValue, type Applicant, type Field } from "../../../agent/v2/apply";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("freshness priority", () => {
  it("buckets postings by age", () => {
    expect(freshness(hoursAgo(3), NOW).key).toBe("today");
    expect(freshness(hoursAgo(30), NOW).key).toBe("2d");
    expect(freshness(hoursAgo(60), NOW).key).toBe("3d");
    expect(freshness(hoursAgo(5 * 24), NOW).key).toBe("week");
    expect(freshness(hoursAgo(10 * 24), NOW).key).toBe("2weeks");
    expect(freshness(hoursAgo(40 * 24), NOW).key).toBe("older");
    expect(freshness(null, NOW).key).toBe("unknown");
  });
  it("a fresh decent match beats an old great match", () => {
    expect(priorityScore(70, hoursAgo(5), NOW)).toBeGreaterThan(priorityScore(90, hoursAgo(20 * 24), NOW));
  });
  it("formats ages", () => {
    expect(ago(hoursAgo(3), NOW)).toBe("3h ago");
    expect(ago(hoursAgo(50), NOW)).toBe("2d ago");
  });
});

describe("planQueue", () => {
  const mk = (company: string, fit: number, h: number) => ({ company, fit, postedAt: hoursAgo(h) });
  it("caps each company at COMPANY_DAILY_CAP per day and orders freshest-first", () => {
    const items = [...Array.from({ length: COMPANY_DAILY_CAP + 3 }, (_, i) => mk("Acme Inc", 80, i + 1)), mk("Beta", 60, 2), mk("Gamma", 95, 24 * 20)];
    const { picked, skippedForCompanyCap } = planQueue(items, { now: NOW });
    expect(picked.filter((x) => companyKey(x.company) === "acme")).toHaveLength(COMPANY_DAILY_CAP);
    expect(skippedForCompanyCap).toHaveLength(3);
    expect(picked[0].company).toBe("Acme Inc");
    expect(picked.at(-1)?.company).toBe("Gamma"); // old posting goes last despite top fit
  });
  it("counts what was already sent today", () => {
    const { picked } = planQueue([mk("Acme", 80, 1), mk("acme, inc.", 80, 2)], { appliedToday: { acme: COMPANY_DAILY_CAP - 1 }, now: NOW });
    expect(picked).toHaveLength(1);
  });
});

describe("common questions", () => {
  it("recognises typical form labels", () => {
    expect(questionFor("Please identify your race")?.key).toBe("race");
    expect(questionFor("Are you Hispanic/Latino?")?.key).toBe("hispanic_latino");
    expect(questionFor("Veteran Status")?.key).toBe("veteran");
    expect(questionFor("Disability Status")?.key).toBe("disability");
    expect(questionFor("Gender")?.key).toBe("gender");
    expect(questionFor("What is your sexual orientation?")?.key).toBe("lgbtq");
    expect(questionFor("How did you hear about this job?")?.key).toBe("how_heard");
    expect(questionFor("What is your desired salary?")?.key).toBe("desired_salary");
    expect(questionFor("Are you at least 18 years of age?")?.key).toBe("over_18");
    expect(questionFor("Email")).toBeNull();
  });
  it("maps saved answers onto each form's own option wording", () => {
    expect(pickOption("Decline to self-identify", ["Male", "Female", "I don't wish to answer"])).toBe("I don't wish to answer");
    expect(pickOption("Yes", ["Yes, I am", "No, I am not"])).toBe("Yes, I am");
    expect(pickOption("I am not a protected veteran", ["I identify as one or more of the classifications of protected veteran", "I am not a protected veteran", "I don't wish to answer"])).toBe(
      "I am not a protected veteran"
    );
    expect(pickOption("No, I do not have a disability", ["Yes, I have a disability (or previously had a disability)", "No, I do not have a disability and have not had one in the past", "I do not want to answer"])).toBe(
      "No, I do not have a disability and have not had one in the past"
    );
    expect(pickOption("Black or African American", ["White", "Black or African American", "Asian"])).toBe("Black or African American");
  });
  it("turns multi-choice answers into yes/no when the form asks yes/no", () => {
    expect(answerFromProfile("Are you able to work onsite 3 days a week?", ["Yes", "No"], { work_mode: "Remote only" })).toBe("No");
    expect(answerFromProfile("Are you able to work onsite 3 days a week?", ["Yes", "No"], { work_mode: "Remote, hybrid or onsite" })).toBe("Yes");
  });
  it("remembers only generic AI answers", () => {
    expect(isJobSpecific("Why do you want to work at Stripe?", "Stripe")).toBe(true);
    expect(isJobSpecific("Do you have experience with Kubernetes?", "Stripe")).toBe(false);
    const m = rememberAnswers({}, [
      { label: "Do you have experience with Kubernetes?", answer: "Yes", company: "Stripe" },
      { label: "Why Stripe?", answer: "…", company: "Stripe" },
    ]);
    expect(Object.keys(m)).toEqual([memoryKey("Do you have experience with Kubernetes?")]);
  });
});

describe("form filler (no AI)", () => {
  const a: Applicant = {
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    phone: "555",
    city: "Atlanta",
    state: "GA",
    work_authorized_us: true,
    sponsorship_needed: false,
    resume_text: "",
    answers: { gender: "Female", veteran: "I am not a protected veteran", start_date: "May 2027" },
    memory: { [memoryKey("Do you have experience with Kubernetes?")]: "Yes" },
    portal: { email: "ada@example.com", password: "Secret!123" },
  };
  const f = (label: string, kind: Field["kind"] = "text", options: string[] = []): Field => ({ id: "f1", label, kind, required: true, options });
  it("answers authorization and sponsorship from the profile", () => {
    expect(knownValue(f("Are you legally authorized to work in the United States?", "select", ["Yes", "No"]), a)).toBe("Yes");
    expect(knownValue(f("Will you now or in the future require visa sponsorship?", "select", ["Yes", "No"]), a)).toBe("No");
    expect(knownValue(f("Are you authorized to work in the US without requiring sponsorship?", "radio", ["Yes", "No"]), a)).toBe("Yes");
  });
  it("handles the tricky labels seen in real forms", () => {
    expect(knownValue(f("What is your preferred name/nickname? Please feel free to include phonetic pronunciation*"), a)).toBe("Ada");
    expect(knownValue(f("Mobile Apps Engineering", "checkbox"), a)).toBeNull();
    expect(knownValue(f("Mobile Number"), a)).toBe("555");
    expect(knownValue(f("Location - City and State of Residence"), a)).toBe("Atlanta, GA");
    expect(knownValue(f("Country*", "select", ["Canada", "United States", "Mexico"]), a)).toBe("United States");
    expect(
      knownValue(f("Please note that sponsorship is not allowed for this role. Please confirm your knowledge of this by selecting 'Yes'.", "select", ["Yes", "No"]), a)
    ).toBeNull();
  });
  it("uses saved common answers, remembered answers and the portal password", () => {
    expect(knownValue(f("Gender", "select", ["Male", "Female", "Decline to self-identify"]), a)).toBe("Female");
    expect(knownValue(f("When can you start?"), a)).toBe("May 2027");
    expect(knownValue(f("Do you have experience with Kubernetes?", "select", ["Yes", "No"]), a)).toBe("Yes");
    expect(knownValue(f("Create a password", "text"), a)).toBe("Secret!123");
    expect(knownValue(f("Race", "select", ["White", "Asian", "Decline"]), a)).toBeNull();
  });
});

describe("schedule", () => {
  it("finds the next :17 of every second UTC hour", () => {
    expect(nextScheduledRun(new Date("2026-11-06T00:03:00Z")).toISOString()).toBe("2026-11-06T00:17:00.000Z");
    expect(nextScheduledRun(new Date("2026-11-06T00:20:00Z")).toISOString()).toBe("2026-11-06T02:17:00.000Z");
    expect(nextScheduledRun(new Date("2026-11-06T23:00:00Z")).toISOString()).toBe("2026-11-07T00:17:00.000Z");
  });
});

describe("questions asked to the user", () => {
  const store = {
    [memoryKey("Do you have 3+ years of experience with Python?")]: "Yes",
    [memoryKey("Are you willing to work from our New York office 3 days a week?")]: "Yes",
    [memoryKey("Are you authorized to work in the United Kingdom?")]: "No",
  };
  it("reuses an answer for the same or a reworded question", () => {
    expect(findSimilarAnswer("Do you have 3+ years of experience with Python?", ["Yes", "No"], store)).toBe("Yes");
    expect(findSimilarAnswer("Do you have 3+ years experience in Python?*", ["Yes, I do", "No"], store)).toBe("Yes, I do");
  });
  it("does not reuse answers for questions that differ in what matters", () => {
    expect(findSimilarAnswer("Do you have 5+ years of experience with Python?", ["Yes", "No"], store)).toBeNull();
    expect(findSimilarAnswer("Are you authorized to work in Canada?", ["Yes", "No"], store)).toBeNull();
    expect(findSimilarAnswer("Do you have 3+ years of experience with Java?", ["Yes", "No"], store)).toBeNull();
  });
  it("the form filler uses the user's own answers", () => {
    const a: Applicant = { first_name: "A", last_name: "B", email: "a@b.c", resume_text: "", custom: store };
    const f: Field = { id: "f1", label: "Do you have 3+ years of experience with Python? *", kind: "select", required: true, options: ["Yes", "No"] };
    expect(knownValue(f, a)).toBe("Yes");
  });
  it("customStore flattens saved answers", () => {
    expect(customStore({ k: { q: "Q?", a: "A" }, e: { q: "E?", a: "" } })).toEqual({ k: "A" });
  });
});
