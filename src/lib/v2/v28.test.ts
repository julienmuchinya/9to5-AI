import { describe, expect, it } from "vitest";
import { postedDaysAgo } from "./discovery/workday";
import { isStemTitle, setWantedRoles } from "./discovery/filters";
import { isFocusTitle, matchPosting, type MatchProfile } from "./match";
import { MAX_POSTING_AGE_DAYS, planQueue, tooOld } from "./priority";
import { cleanTitle } from "./title-suggestions";

const profile: MatchProfile = {
  skills: ["Python", "React", "SQL"],
  target_roles: ["Software Engineer"],
  job_levels: ["internship", "new_grad", "entry"],
  min_salary: 60000,
  locations: ["remote_us", "GA"],
  relocation: false,
  keywords_include: [],
  keywords_exclude: [],
  excluded_companies: [],
};
const roustabout = {
  title: "Roustabout",
  company_name: "Noble Corporation",
  level: "mid",
  locations: ["Gulf of Mexico, United States"],
  is_remote: false,
  salary_min: null,
  salary_max: null,
  description: "Offshore drilling rig crew member on an oil and gas platform.",
};

describe("oil & gas / offshore jobs", () => {
  it("reads Workday's posted-on text", () => {
    expect(postedDaysAgo("Posted Today")).toBe(0);
    expect(postedDaysAgo("Posted Yesterday")).toBe(1);
    expect(postedDaysAgo("Posted 7 Days Ago")).toBe(7);
    expect(postedDaysAgo("Posted 30+ Days Ago")).toBe(31);
    expect(postedDaysAgo("")).toBeNull();
  });

  it("keeps energy and field titles in discovery", () => {
    for (const t of ["Roustabout", "Lease Operator", "Assistant Driller", "Pipeline Operator - Intermediate", "Petroleum Engineer", "Subsea Technician"]) expect(isStemTitle(t), t).toBe(true);
    expect(isStemTitle("Account Executive")).toBe(false);
  });

  it("keeps any title the user asked for", () => {
    expect(isStemTitle("Warehouse Lead")).toBe(false);
    setWantedRoles(["Warehouse Lead"]);
    expect(isStemTitle("Warehouse Lead - Night Shift")).toBe(true);
    setWantedRoles([]);
  });

  it("focus roles match by title, or by industry words in the description", () => {
    expect(isFocusTitle("Roustabout", ["Roustabout"])).toBe(true);
    expect(isFocusTitle("Field Operator II", ["Field Operator"])).toBe(true);
    expect(isFocusTitle("Roustabout", ["oil and gas"], roustabout.description)).toBe(true);
    expect(isFocusTitle("Software Engineer", ["Roustabout"])).toBe(false);
    // A job title (not an industry) must be in the title itself.
    expect(isFocusTitle("Software Engineer", ["Field Operator"], "field operator tools")).toBe(false);
  });

  it("a focus role is eligible anywhere in the US at an unlabeled level, and scores past the default 65", () => {
    const without = matchPosting(profile, roustabout);
    expect(without.eligible).toBe(false);
    const withFocus = matchPosting({ ...profile, focus_roles: ["Roustabout", "offshore"] }, roustabout);
    expect(withFocus.eligible).toBe(true);
    expect(withFocus.score).toBeGreaterThanOrEqual(65);
    expect(withFocus.reasons).toContain("The role you asked for");
  });

  it("focus roles still skip senior postings", () => {
    expect(matchPosting({ ...profile, focus_roles: ["Rig Manager"] }, { ...roustabout, title: "Senior Rig Manager", level: "senior" }).eligible).toBe(false);
  });
});

describe("priorities and age", () => {
  it("skips postings older than 2 weeks", () => {
    expect(MAX_POSTING_AGE_DAYS).toBe(14);
    const now = Date.parse("2026-11-12T12:00:00Z");
    expect(tooOld("2026-10-27T12:00:00Z", MAX_POSTING_AGE_DAYS, now)).toBe(true);
    expect(tooOld("2026-11-01T12:00:00Z", MAX_POSTING_AGE_DAYS, now)).toBe(false);
    expect(tooOld(null, MAX_POSTING_AGE_DAYS, now)).toBe(false);
  });

  it("the role just asked for goes before fresher, better-fitting jobs", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    const { picked } = planQueue(
      [
        { company: "Stripe", fit: 95, postedAt: "2026-11-12T08:00:00Z" },
        { company: "Noble", fit: 66, postedAt: "2026-11-05T08:00:00Z", focus: true },
      ],
      { now }
    );
    expect(picked[0].company).toBe("Noble");
  });

  it("cleans titles for suggestions", () => {
    expect(cleanTitle("Software Engineer I (Remote)")).toBe("Software Engineer");
    expect(cleanTitle("Junior Data Analyst - Atlanta, GA")).toBe("Data Analyst");
  });
});
