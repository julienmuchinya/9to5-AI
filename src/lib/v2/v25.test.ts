import { describe, expect, it } from "vitest";
import { minutesPlan } from "./minutes";
import { buildDigest } from "../../../agent/v2/digest";
import { toChatMessages } from "./gemini";
import { canAutoSubmit } from "./verify";
import { applyUrlFor } from "../../../agent/v2/apply";

const base = { limit: 2000, ratio: 0.85, maxRunMin: 40, publicRepo: false };
const nov8 = new Date("2026-11-08T15:00:00Z"); // 23 days left including today

describe("GitHub minutes planner", () => {
  it("spreads what's left of the month over the days left", () => {
    const p = minutesPlan({ ...base, usedMonth: 215, usedToday: 0, manual: false, now: nov8 });
    expect(p.dayAllowance).toBe(Math.floor((1700 - 215) / 23)); // 64
    expect(p.budgetMin).toBe(40);
    expect(p.skip).toBe(false);
  });
  it("skips a scheduled run once today's share is used, but lets a manual run through", () => {
    const sched = minutesPlan({ ...base, usedMonth: 280, usedToday: 62, manual: false, now: nov8 });
    expect(sched.skip).toBe(true);
    const manual = minutesPlan({ ...base, usedMonth: 280, usedToday: 62, manual: true, now: nov8 });
    expect(manual.skip).toBe(false);
    expect(manual.budgetMin).toBeGreaterThanOrEqual(15);
  });
  it("stops everything at 85% of the month", () => {
    expect(minutesPlan({ ...base, usedMonth: 1699, usedToday: 0, manual: true, now: nov8 }).skip).toBe(true);
  });
  it("doesn't ration a public repo", () => {
    expect(minutesPlan({ ...base, publicRepo: true, usedMonth: 5000, usedToday: 900, manual: false, now: nov8 })).toMatchObject({ skip: false, budgetMin: 40 });
  });
});

describe("summary email", () => {
  it("lists what was sent and groups what needs you", () => {
    const m = buildDigest({
      name: "Alex",
      appUrl: "https://app.test",
      manual: true,
      sent: [{ company: "Acme", title: "SWE Intern" }],
      needs: [
        { company: "Figure", title: "Intern", kind: "captcha", why: "CAPTCHA appeared" },
        { company: "Bosch", title: "Co-op", kind: "manual", why: "SmartRecruiters" },
      ],
      queued: 12,
    });
    expect(m.subject).toBe("9to5 AI: 1 sent, 2 need you");
    expect(m.text).toContain("Acme — SWE Intern");
    expect(m.html).toContain("https://app.test/applications?tab=needs");
    expect(m.html).not.toContain("<script");
  });
  it("adds the weekly resume report with a suggestion", () => {
    const m = buildDigest({
      name: "Alex",
      appUrl: "https://app.test",
      manual: false,
      sent: [],
      needs: [],
      queued: 0,
      weekly: [
        { label: "AI resume", stats: { sent: 10, progressed: 3, interviews: 1, rejected: 2, rate: 0.3 } },
        { label: "Main resume", stats: { sent: 8, progressed: 1, interviews: 0, rejected: 3, rate: 0.125 } },
      ],
    });
    expect(m.text).toContain("Weekly resume report");
    expect(m.text).toContain("AI resume is getting the best response");
  });
  it("escapes job titles in the HTML", () => {
    const m = buildDigest({ name: "A", appUrl: "https://x", manual: true, sent: [{ company: "<b>Evil</b>", title: "x" }], needs: [], queued: 0 });
    expect(m.html).toContain("&lt;b&gt;Evil");
  });
});

describe("chat on the backup AI", () => {
  it("turns a Gemini tool conversation into OpenAI messages with matching call ids", () => {
    const msgs = toChatMessages(
      [
        { role: "user", parts: [{ text: "how many queued?" }] },
        { role: "model", parts: [{ functionCall: { name: "get_status", args: {} } }] },
        { role: "user", parts: [{ functionResponse: { name: "get_status", response: { queued: 3 } } }] },
      ],
      "be brief"
    );
    expect(msgs[0]).toEqual({ role: "system", content: "be brief" });
    const call = msgs[2].tool_calls![0];
    expect(call.function.name).toBe("get_status");
    expect(msgs[3]).toMatchObject({ role: "tool", tool_call_id: call.id });
  });
});

describe("Workable", () => {
  it("auto-submits verified Workable postings, not SmartRecruiters", () => {
    expect(canAutoSubmit({ ats: "other", verification_status: "verified", url: "https://apply.workable.com/acme/j/ABC123/apply" })).toBe(true);
    expect(canAutoSubmit({ ats: "other", verification_status: "review", url: "https://apply.workable.com/acme/j/ABC123/apply" })).toBe(false);
    expect(canAutoSubmit({ ats: "other", verification_status: "verified", url: "https://jobs.smartrecruiters.com/Acme/123" })).toBe(false);
  });
  it("opens the application form, not the job description", () => {
    expect(applyUrlFor("other", "https://apply.workable.com/acme/j/ABC123/")).toBe("https://apply.workable.com/acme/j/ABC123/apply");
    expect(applyUrlFor("other", "https://apply.workable.com/acme/j/ABC123/apply")).toBe("https://apply.workable.com/acme/j/ABC123/apply");
  });
});
