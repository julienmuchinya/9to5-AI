import { describe, expect, it } from "vitest";
import { keepPosting, type Posting } from "./discovery/sources";
import { industrySectors, relevance } from "./discovery/live-search";
import { matchPosting } from "./match";
import { roleFamily } from "./tracking";

const posting = (title: string, extra: Partial<Posting> = {}): Posting => ({
  source: "greenhouse",
  source_key: `x:${title}`,
  company_name: "Acme",
  title,
  level: "entry",
  locations: ["Houston, TX"],
  is_remote: false,
  url: "https://boards.greenhouse.io/acme/jobs/1",
  posted_at: new Date().toISOString(),
  ...extra,
});

describe("any field, not only STEM", () => {
  it("keeps jobs in every field", () => {
    for (const t of ["Registered Nurse - ICU", "CDL Truck Driver", "Cashier", "Account Executive", "Roustabout", "Executive Assistant", "Software Engineer"])
      expect(keepPosting(posting(t)), t).toBe(true);
  });
  it("still drops jobs outside the US", () => {
    expect(keepPosting(posting("Nurse", { locations: ["London, UK"] }))).toBe(false);
  });
  it("doesn't mark a nurse or driver down for not being engineering", () => {
    const profile = { skills: ["patient care"], target_roles: ["Registered Nurse"], job_levels: ["entry"], min_salary: null, locations: ["anywhere_us"], relocation: true, keywords_include: [], keywords_exclude: [], excluded_companies: [] };
    const m = matchPosting(profile, { title: "Registered Nurse", company_name: "CVS Health", level: "entry", locations: ["Houston, TX"], is_remote: false, salary_min: null, salary_max: null, description: "patient care" });
    expect(m.eligible).toBe(true);
    expect(m.reasons.join(" ")).not.toMatch(/engineering/i);
    expect(m.score).toBeGreaterThanOrEqual(70);
  });
  it("groups non-tech jobs sensibly", () => {
    expect(roleFamily("Registered Nurse")).toBe("Healthcare");
    expect(roleFamily("CDL Truck Driver")).toBe("Logistics / Driving");
    expect(roleFamily("Roustabout")).toBe("Energy / Field");
  });
});

describe("keyword search is general", () => {
  it("an industry word reaches the employers in that industry", () => {
    expect(industrySectors("oil")).toContain("energy");
    expect(industrySectors("oil and gas jobs")).toContain("energy");
    expect(industrySectors("hospital")).toContain("healthcare");
    expect(industrySectors("bank teller")).toContain("finance");
    expect(industrySectors("cashier")).toEqual([]);
  });
  it("keeps jobs that don't say the word in the title, ranked after those that do", () => {
    expect(relevance({ title: "Oil Field Operator", company: "Chevron", source: "workday" }, "oil")).toBe(3);
    expect(relevance({ title: "Roustabout", company: "Chevron", source: "workday" }, "oil")).toBe(1);
    expect(relevance({ title: "Warehouse Associate", company: "Remote Co", source: "remotive", description: "Ships oil filters" }, "oil")).toBe(1);
    expect(relevance({ title: "Barista", company: "Cafe", source: "remotive", description: "coffee" }, "oil")).toBe(0);
  });
});
