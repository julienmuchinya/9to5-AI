import { describe, expect, it } from "vitest";
import { DEFAULT_TUNING, freshWeight, readTuning } from "./tuning";
import { planQueue } from "./priority";
import { changeNotAsked } from "./chat-guard";
import { compact, summarizeActions } from "../../app/api/chat/tools";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("your own settings for picking jobs", () => {
  it("falls back to defaults and keeps every value in range", () => {
    expect(readTuning(null)).toEqual(DEFAULT_TUNING);
    expect(readTuning({ max_age_days: 999, company_cap: 0, order: "weird", focus_first: "yes" })).toEqual({ ...DEFAULT_TUNING, max_age_days: 30, company_cap: 1 });
    expect(readTuning({ max_age_days: "7", order: "fit", mine_first: false })).toMatchObject({ max_age_days: 7, order: "fit", mine_first: false });
  });

  it("'best fit first' and 'newest first' really change the order", () => {
    const items = [
      { company: "Old but perfect", fit: 95, postedAt: hoursAgo(24 * 9) },
      { company: "New but okay", fit: 62, postedAt: hoursAgo(3) },
    ];
    expect(planQueue(items, { now: NOW, freshWeight: freshWeight("fit") }).picked[0].company).toBe("Old but perfect");
    expect(planQueue(items, { now: NOW, freshWeight: freshWeight("fresh") }).picked[0].company).toBe("New but okay");
  });

  it("'my requests first' puts jobs you queued ahead of better agent picks", () => {
    const items = [
      { company: "Agent pick", fit: 90, postedAt: hoursAgo(2) },
      { company: "Mine", fit: 60, postedAt: hoursAgo(30), userRequested: true },
    ];
    expect(planQueue(items, { now: NOW, mineFirst: true }).picked[0].company).toBe("Mine");
    expect(planQueue(items, { now: NOW, mineFirst: false }).picked[0].company).toBe("Agent pick");
  });

  it("the per-company limit is yours to set", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ company: "Acme", fit: 70, postedAt: hoursAgo(i + 1) }));
    expect(planQueue(items, { now: NOW, perCompany: 2 }).picked).toHaveLength(2);
  });
});

describe("chat", () => {
  it("industry and field requests count as preference changes", () => {
    expect(changeNotAsked("update_preferences", "apply for jobs in the mineral industry, oil and gas and offshore")).toBeNull();
    expect(changeNotAsked("update_preferences", "focus on nursing jobs in Texas")).toBeNull();
    expect(changeNotAsked("update_preferences", "minimum pay is $30 per hour")).toBeNull();
    expect(changeNotAsked("run_agent_now", "How many so far applied to")).not.toBeNull();
  });

  it("when the AI runs out of time, the reply comes from what the tools found", () => {
    const text = summarizeActions([
      { tool: "list_applications", result: { total: 12, applications: [{ title: "Roustabout", company: "Noble" }, { title: "Field Operator", company: "ONEOK" }] } },
      { tool: "run_agent_now", result: { started: true } },
      { tool: "dismiss_jobs", result: { error: "Not done" } },
    ]);
    expect(text).toContain("total: 12");
    expect(text).toContain("Roustabout — Noble");
    expect(text).toContain("Started an agent run");
    expect(text).not.toContain("Not done");
    expect(summarizeActions([])).toMatch(/try again/i);
    expect(summarizeActions([{ tool: "get_status", result: { matched_jobs: 2830, applications: { submitted: 265, interview: 4 } } }])).toContain("applications — submitted 265, interview 4");
  });

  it("long tool results are cut down before going back to the AI", () => {
    const big = { total: 300, applications: Array.from({ length: 300 }, (_, i) => ({ id: `id-${i}`, title: "Some long job title here", company: "Company name", why: "x".repeat(80) })) };
    const small = compact(big) as { applications: unknown[] };
    expect(JSON.stringify(small).length).toBeLessThan(9_500);
    expect(small.applications.at(-1)).toBe("…and 288 more");
    expect(compact({ ok: true })).toEqual({ ok: true });
  });
});
