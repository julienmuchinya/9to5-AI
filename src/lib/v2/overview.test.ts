import { describe, expect, it } from "vitest";
import { funnel, greeting, hourIn, pct, stateLabel, weekActivity } from "./overview";

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(13)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
    expect(greeting(2)).toBe("Good evening");
  });
  it("reads the hour in the viewer's zone", () => {
    expect(hourIn("UTC", new Date("2026-11-14T15:30:00Z"))).toBe(15);
    expect(hourIn("America/New_York", new Date("2026-11-14T15:30:00Z"))).toBe(10);
  });
});

describe("weekActivity", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  it("buckets real submissions into the last 7 days, today last", () => {
    const days = weekActivity(["2026-11-14T09:00:00Z", "2026-11-14T10:00:00Z", "2026-11-10T09:00:00Z", "2026-10-01T00:00:00Z", null], "UTC", now);
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ label: "Sat", count: 2 });
    expect(days[2]).toMatchObject({ label: "Tue", count: 1 });
    expect(days.reduce((s, d) => s + d.count, 0)).toBe(3); // the October one is outside the window
  });
});

describe("funnel", () => {
  it("counts only evidenced states and keeps submitted apart from confirmed", () => {
    const f = funnel([
      { status: "queued" },
      { status: "needs_user" },
      { status: "submitted", submitted_at: "2026-11-01" },
      { status: "received" },
      { status: "under_review" },
      { status: "interview" },
      { status: "offer" },
      { status: "rejected" },
    ]);
    expect(f).toEqual({ tracked: 8, sent: 6, confirmed: 5, responses: 4, interviews: 2, offers: 1 });
  });
  it("shows no rate rather than 0% when nothing was sent", () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(1, 3)).toBe(33);
  });
});

describe("stateLabel", () => {
  it("never calls an unconfirmed submission confirmed", () => {
    expect(stateLabel("submitted").label).toMatch(/unconfirmed/i);
    expect(stateLabel("received").label).toMatch(/confirmed/i);
  });
});
