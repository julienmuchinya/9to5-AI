import { describe, expect, it } from "vitest";
import { searchStems, titleMatches } from "./discovery/live-search";
import { appTabFilter, isAppTab } from "./app-filter";

describe("live search relevance", () => {
  it("keeps titles that contain every search word", () => {
    expect(titleMatches("Registered Nurse - ICU", "nurse", "all")).toBe(true);
    expect(titleMatches("Sales Associate - Plumbing", "nurse", "all")).toBe(false);
    expect(titleMatches("Financial Data Analyst III", "data analyst", "all")).toBe(true);
    expect(titleMatches("Business Analyst", "data analyst", "all")).toBe(false);
    expect(titleMatches("Business Analyst", "data analyst", "any")).toBe(true);
  });
  it("handles plurals and filler words", () => {
    expect(searchStems("Nurses jobs in Texas")).toHaveLength(2); // "jobs" and "in" dropped
    expect(titleMatches("Registered Nurse, Houston Texas", "Nurses jobs in Texas", "all")).toBe(true);
    expect(titleMatches("Analytics Engineer", "analysts", "all")).toBe(true);
    expect(titleMatches("Anything", "the and", "all")).toBe(true);
  });
});

describe("applications filter tabs", () => {
  it("narrows each tab the same way the page counts it", () => {
    expect(appTabFilter("needs")).toEqual({ statuses: ["needs_user"] });
    expect(appTabFilter("all")).toEqual({});
    expect(appTabFilter("sent").or).toMatch(/^submitted_at\.not\.is\.null,status\.in\./);
    expect(isAppTab("interview")).toBe(true);
    expect(isAppTab("nope")).toBe(false);
  });
});

describe("ignored applications", () => {
  it("are counted on their own, never as sent", async () => {
    const { countPipeline } = await import("./pipeline");
    const c = countPipeline([{ status: "ignored" }, { status: "submitted", submitted_at: "x" }]);
    expect(c).toMatchObject({ total: 2, sent: 1, ignored: 1 });
  });
});

describe("drafts", () => {
  it("are counted on their own, never as sent, and labelled as not sent", async () => {
    const { countPipeline } = await import("./pipeline");
    const { stateLabel } = await import("./overview");
    expect(countPipeline([{ status: "draft" }, { status: "queued" }])).toMatchObject({ total: 2, sent: 0, drafts: 1, queued: 1 });
    expect(stateLabel("draft").label).toMatch(/not sent/i);
  });
});
