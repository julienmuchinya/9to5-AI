import { describe, expect, it } from "vitest";
import { isInState, isStemTitle, setWantedRoles, stateCode } from "./discovery/filters";
import { matchPosting, type MatchProfile } from "./match";
import { agentCanSubmit, AUTO_SUBMIT_OR, canAutoSubmit } from "./verify";
import { applyUrlFor } from "../../../agent/v2/apply";
import { ROLE_CATALOG } from "./role-catalog";
import { COMPANY_DAILY_CAP, DEFAULT_DAILY_CAP, DEFAULT_MIN_FIT, MAX_DAILY_APPLY_CAP } from "./priority";
import { WORKDAY_BOARDS } from "./discovery/workday";

const nurse: MatchProfile = {
  skills: ["Patient care", "BLS", "Epic"],
  target_roles: ["Registered Nurse"],
  job_levels: ["entry", "mid"],
  min_salary: 40000,
  locations: ["my_state"],
  relocation: false,
  keywords_include: [],
  keywords_exclude: [],
  excluded_companies: [],
  home_state: "Texas",
};
const posting = (title: string, locations: string[], extra: Partial<Parameters<typeof matchPosting>[1]> = {}) => ({
  title,
  company_name: "CVS Health",
  level: "mid",
  locations,
  is_remote: false,
  salary_min: null,
  salary_max: null,
  description: "Provide patient care using Epic. BLS required.",
  ...extra,
});

describe("jobs in any field", () => {
  it("keeps any title a user asked for, not only tech", () => {
    setWantedRoles(["Registered Nurse", "Store Associate"]);
    expect(isStemTitle("Registered Nurse - ICU")).toBe(true);
    expect(isStemTitle("Store Associate (Part-Time)")).toBe(true);
    expect(isStemTitle("Account Executive")).toBe(false);
    setWantedRoles([]);
    expect(isStemTitle("Registered Nurse - ICU")).toBe(false);
  });

  it("a nurse matches nursing jobs in their state, with no tech penalty", () => {
    const m = matchPosting(nurse, posting("Registered Nurse", ["Houston, TX"]));
    expect(m.eligible).toBe(true);
    expect(m.score).toBeGreaterThanOrEqual(DEFAULT_MIN_FIT);
    expect(m.reasons).toContain("In your state (Texas)");
    expect(m.reasons).not.toContain("Not an engineering title");
    expect(matchPosting(nurse, posting("Registered Nurse", ["Phoenix, AZ"])).eligible).toBe(false);
  });

  it("reads states in the usual formats", () => {
    expect(stateCode("tx")).toBe("TX");
    expect(stateCode("Georgia")).toBe("GA");
    expect(stateCode("Ontario")).toBeNull();
    expect(isInState("Houston, TX", "TX")).toBe(true);
    expect(isInState("US-TX-Houston", "Texas")).toBe(true);
    expect(isInState("Remote - Texas", "TX")).toBe(true);
    expect(isInState("Atlanta, GA", "TX")).toBe(false);
    expect(isInState("Washington, DC", "WA")).toBe(false);
    expect(isInState("Seattle, Washington", "WA")).toBe(true);
  });

  it("offers roles in many fields", () => {
    expect(ROLE_CATALOG.length).toBeGreaterThanOrEqual(12);
    const all = ROLE_CATALOG.flatMap((g) => g.roles);
    for (const r of ["Registered Nurse", "Accountant", "Roustabout", "Customer Service Representative", "Software Engineer"]) expect(all).toContain(r);
  });

  it("searches employers in many industries", () => {
    const sectors = new Set(WORKDAY_BOARDS.map((b) => b.sector));
    for (const s of ["energy", "healthcare", "finance", "retail", "government", "tech"]) expect(sectors.has(s as never)).toBe(true);
    expect(WORKDAY_BOARDS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(WORKDAY_BOARDS.map((b) => `${b.host}/${b.site}`)).size).toBe(WORKDAY_BOARDS.length);
  });
});

describe("more sites the agent submits to", () => {
  const v = (apply_url: string, ats = "other") => ({ ats, verification_status: "verified", apply_url, url: apply_url });
  it("JazzHR and Jobvite are submitted by the agent", () => {
    expect(canAutoSubmit(v("https://lamons.applytojob.com/apply/6SA4nACfmW/Business-Intelligence-Analyst"))).toBe(true);
    expect(canAutoSubmit(v("https://jobs.jobvite.com/iboss/job/orvdAfwt"))).toBe(true);
    expect(canAutoSubmit(v("https://jobs.smartrecruiters.com/TTP1/744000130799419"))).toBe(false);
    expect(AUTO_SUBMIT_OR).toContain("applytojob.com");
  });
  it("the app's 'Agent can submit' includes Workday and needs a verified employer", () => {
    expect(agentCanSubmit(v("https://noblecorp.wd1.myworkdayjobs.com/noblecorp/job/x/Roustabout_1", "workday"))).toBe(true);
    expect(agentCanSubmit({ ...v("https://jobs.lever.co/acme/1", "lever"), verification_status: "review" })).toBe(false);
  });
  it("goes straight to Jobvite's form page", () => {
    expect(applyUrlFor("other", "https://jobs.jobvite.com/iboss/job/orvdAfwt?nl=1&fr=false")).toBe("https://jobs.jobvite.com/iboss/job/orvdAfwt/apply");
    expect(applyUrlFor("other", "https://jobs.jobvite.com/iboss/job/orvdAfwt/apply")).toBe("https://jobs.jobvite.com/iboss/job/orvdAfwt/apply");
  });
});

describe("higher limits", () => {
  it("starts new accounts on a high daily cap and a lower fit bar", () => {
    expect(DEFAULT_DAILY_CAP).toBe(100);
    expect(MAX_DAILY_APPLY_CAP).toBe(500);
    expect(DEFAULT_MIN_FIT).toBe(55);
    expect(COMPANY_DAILY_CAP).toBe(15);
  });
});
