import { describe, expect, it } from "vitest";
import { atsFromUrl, detectLevel, isGeorgia, isStemTitle, isUsRemote, parseSalary } from "./discovery/filters";
import { verifyPosting, canAutoSubmit } from "./verify";
import { matchPosting, type MatchProfile } from "./match";
import { tailorResume, renderResumePdf } from "./resume";
import type { Posting } from "./discovery/sources";

const base: Posting = {
  source: "greenhouse",
  source_key: "greenhouse:acme:1",
  company_name: "Acme",
  title: "Software Engineer Intern",
  level: "internship",
  locations: ["Atlanta, GA"],
  is_remote: false,
  url: "https://job-boards.greenhouse.io/acme/jobs/1",
  apply_url: "https://job-boards.greenhouse.io/acme/jobs/1",
  ats: "greenhouse",
  description: "Build services in Python and React.",
};

describe("filters", () => {
  it("recognizes STEM titles and rejects non-STEM", () => {
    expect(isStemTitle("Backend Software Engineer")).toBe(true);
    expect(isStemTitle("Data Analyst Intern")).toBe(true);
    expect(isStemTitle("Account Executive")).toBe(false);
    expect(isStemTitle("Technical Recruiter")).toBe(false);
  });
  it("detects levels", () => {
    expect(detectLevel("Software Engineering Intern - Summer 2027")).toBe("internship");
    expect(detectLevel("New Grad Software Engineer")).toBe("new_grad");
    expect(detectLevel("Senior Backend Engineer")).toBe("senior");
    expect(detectLevel("Software Engineer I")).toBe("entry");
  });
  it("parses salaries, annualizing hourly pay", () => {
    expect(parseSalary("The range is $90,000 - $120,000 per year")).toEqual({ min: 90000, max: 120000 });
    expect(parseSalary("$85K–$110K + equity")).toEqual({ min: 85000, max: 110000 });
    expect(parseSalary("$40 - $50 per hour")).toEqual({ min: 83200, max: 104000 });
  });
  it("handles locations", () => {
    expect(isGeorgia("Atlanta, GA")).toBe(true);
    expect(isGeorgia("Tbilisi, Georgia (country)")).toBe(false);
    expect(isUsRemote("Remote - US")).toBe(true);
    expect(isUsRemote("Remote - Canada")).toBe(false);
  });
  it("reads ATS boards from URLs", () => {
    expect(atsFromUrl("https://jobs.lever.co/palantir/abc")).toEqual({ ats: "lever", board: "palantir" });
    expect(atsFromUrl("https://jobs.ashbyhq.com/ramp/123")).toEqual({ ats: "ashby", board: "ramp" });
  });
});

describe("verification", () => {
  it("verifies employer-hosted postings from curated sources", () => {
    const v = verifyPosting(base);
    expect(v.status).toBe("verified");
    expect(canAutoSubmit({ ...base, verification_status: v.status })).toBe(true);
  });
  it("rejects classic scams", () => {
    const v = verifyPosting({
      ...base,
      source: "remoteok",
      url: "https://forms.gle/abc",
      apply_url: "https://forms.gle/abc",
      description: "Interview on Telegram chat. You will receive a check to deposit and purchase equipment.",
    });
    expect(v.status).toBe("rejected");
    expect(canAutoSubmit({ ...base, url: "https://forms.gle/abc", apply_url: "https://forms.gle/abc", verification_status: v.status })).toBe(false);
  });
  it("never auto-submits on sites outside Greenhouse/Lever/Ashby", () => {
    expect(canAutoSubmit({ ats: "workday", verification_status: "verified", url: "https://x.myworkdayjobs.com/a" })).toBe(false);
  });
});

describe("matching", () => {
  const profile: MatchProfile = {
    skills: ["Python", "React", "PostgreSQL"],
    target_roles: ["Software Engineer"],
    job_levels: ["internship", "new_grad", "entry"],
    min_salary: 80000,
    locations: ["remote_us", "GA"],
    relocation: false,
    keywords_include: [],
    keywords_exclude: ["clearance"],
    excluded_companies: [],
  };
  const mp = (o: Partial<Posting> = {}) => ({ ...base, salary_min: null, salary_max: null, description: base.description ?? null, ...o });
  it("matches a Georgia internship using resume skills", () => {
    const m = matchPosting(profile, mp());
    expect(m.eligible).toBe(true);
    expect(m.score).toBeGreaterThan(60);
  });
  it("accepts mid-level roles only when pay meets the minimum", () => {
    expect(matchPosting(profile, mp({ level: "mid", title: "Software Engineer", salary_max: 120000 })).eligible).toBe(true);
    expect(matchPosting(profile, mp({ level: "mid", title: "Software Engineer", salary_max: 70000 })).eligible).toBe(false);
  });
  it("respects location and exclusions", () => {
    expect(matchPosting(profile, mp({ locations: ["Seattle, WA"] })).eligible).toBe(false);
    expect(matchPosting({ ...profile, relocation: true }, mp({ locations: ["Seattle, WA"] })).eligible).toBe(true);
    expect(matchPosting(profile, mp({ description: "Requires security clearance" })).eligible).toBe(false);
  });
});

describe("resume tailoring", () => {
  const r = {
    name: "Test Person",
    skills: ["Java", "Python", "React"],
    experience: [{ title: "Intern", company: "X", bullets: ["Wrote Java tools", "Built React dashboard in Python backend"] }],
  };
  it("reorders without adding content", () => {
    const t = tailorResume(r, "React Python role");
    expect(t.skills?.slice(0, 2).sort()).toEqual(["Python", "React"]);
    expect(t.experience?.[0].bullets[0]).toContain("React");
    expect(t.experience?.[0].bullets.length).toBe(2);
  });
  it("renders a PDF", async () => {
    const pdf = await renderResumePdf(r);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
  });
});
