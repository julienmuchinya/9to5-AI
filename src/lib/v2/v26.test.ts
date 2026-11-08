import { describe, expect, it } from "vitest";
import { familyOf, judgeRoute, learnRoutes, titleKey } from "./learning";
import { planQueue, tooOld } from "./priority";
import { matchPosting } from "./match";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86400_000).toISOString();

describe("the agent learns which routes work", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => ({ apply_url: "https://jobs.ashbyhq.com/loft/1", status: "needs_user" })),
    ...Array.from({ length: 6 }, () => ({ apply_url: "https://job-boards.greenhouse.io/acme/jobs/1", status: "submitted", submitted_at: "x" })),
    { apply_url: "https://job-boards.greenhouse.io/beta/jobs/2", status: "needs_user" },
    { apply_url: "https://job-boards.greenhouse.io/gone/jobs/3", status: "closed" },
  ];
  const learned = learnRoutes(rows);
  it("skips a board that keeps failing", () => {
    expect(judgeRoute(learned, "https://jobs.ashbyhq.com/loft/9")).toMatchObject({ skip: true });
  });
  it("favours a board that works, and judges a new board by its family", () => {
    const good = judgeRoute(learned, "https://job-boards.greenhouse.io/acme/jobs/7");
    expect(good.skip).toBe(false);
    expect(good.bonus).toBeGreaterThan(0);
    expect(judgeRoute(learned, "https://job-boards.greenhouse.io/newco/jobs/1").bonus).toBeGreaterThan(0);
  });
  it("doesn't count closed postings against a route", () => {
    expect(learned.bySite.get("job-boards.greenhouse.io/gone")).toBeUndefined();
  });
  it("matches the same job on another route", () => {
    expect(titleKey("Software Engineer Intern (Summer 2027)")).toBe(titleKey("Software Engineer Intern - Summer 2027"));
    expect(familyOf("https://apply.workable.com/x/j/1/apply")).toBe("workable");
  });
});

describe("fresh postings first", () => {
  it("drops postings older than the cutoff, keeps unknown dates", () => {
    expect(tooOld(daysAgo(30), 21, NOW)).toBe(true);
    expect(tooOld(daysAgo(5), 21, NOW)).toBe(false);
    expect(tooOld(null, 21, NOW)).toBe(false);
  });
  it("puts a fresh decent fit ahead of an old great fit, and learned routes count", () => {
    const { picked } = planQueue(
      [
        { company: "Old", fit: 95, postedAt: daysAgo(12) },
        { company: "Fresh", fit: 70, postedAt: daysAgo(0.3) },
        { company: "FailingSite", fit: 72, postedAt: daysAgo(0.3), routeBonus: -20 },
      ],
      { now: NOW }
    );
    expect(picked.map((p) => p.company)).toEqual(["Fresh", "FailingSite", "Old"]); // weaker route ranks below the same-age job, still above a 12-day-old one
  });
});

describe("better role matching", () => {
  const profile = { skills: ["Python", "React"], target_roles: ["Software Engineer", "AI Engineer"], job_levels: ["internship", "new_grad", "entry"], locations: ["anywhere_us"], relocation: true } as never;
  const post = (title: string, level = "entry") => ({ title, company_name: "X", description: "Python React", level, locations: ["Austin, TX"], is_remote: false, salary_min: null, salary_max: null });
  it("doesn't treat 'ai' inside another word as a role match", () => {
    const a = matchPosting(profile, post("Maintainer Technician I"));
    const b = matchPosting(profile, post("AI Engineer I"));
    expect(b.score).toBeGreaterThan(a.score);
  });
  it("ranks senior titles below entry ones for an early-career search", () => {
    expect(matchPosting(profile, post("Software Engineer Intern", "internship")).score).toBeGreaterThan(matchPosting(profile, post("Senior Software Engineer")).score);
  });
});

describe("chat only changes things the latest message asks for", async () => {
  const { changeNotAsked } = await import("./chat-guard");
  it("doesn't replay an old cap change on 'answer' or a why-question", () => {
    expect(changeNotAsked("set_autopilot", "answer")).not.toBeNull();
    expect(changeNotAsked("set_autopilot", "why are my submition not being sent or submitted")).not.toBeNull();
    expect(changeNotAsked("set_autopilot", "why is my daily cap so low?")).not.toBeNull();
  });
  it("still does what's asked", () => {
    expect(changeNotAsked("set_autopilot", "Turn on auto-submit with a cap of 20 a day")).toBeNull();
    expect(changeNotAsked("run_agent_now", "run the agent now")).toBeNull();
    expect(changeNotAsked("get_status", "answer")).toBeNull(); // reading is always fine
  });
});

describe("next reset times", async () => {
  const { nextPacificMidnight, nextUtcMidnight } = await import("./ai-status");
  it("Gemini resets at the next midnight in Los Angeles, in winter and summer time", () => {
    expect(nextPacificMidnight(new Date("2026-11-08T03:00:00Z")).toISOString()).toBe("2026-11-08T08:00:00.000Z"); // 7 pm PST Nov 7 → midnight PST
    expect(nextPacificMidnight(new Date("2026-07-01T20:00:00Z")).toISOString()).toBe("2026-07-02T07:00:00.000Z"); // PDT
  });
  it("our backup-AI counters reset at the next midnight UTC", () => {
    expect(nextUtcMidnight(new Date("2026-11-08T23:30:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});

describe("stages: screening vs real interviews", async () => {
  const { classifyEmail, nextStatus } = await import("./tracking");
  it("tells a recruiter screen or assessment from an interview", () => {
    expect(classifyEmail("Next steps", "We'd like to set up a phone screen with our recruiter")).toBe("screening");
    expect(classifyEmail("Your HackerRank assessment", "Please complete the coding challenge")).toBe("screening");
    expect(classifyEmail("Interview invitation", "We'd like to invite you to a technical interview with the team")).toBe("interview");
  });
  it("moves forward through the stages", () => {
    expect(nextStatus("under_review", "screening")).toBe("screening");
    expect(nextStatus("screening", "interview")).toBe("interview");
    expect(nextStatus("interview", "screening")).toBe("interview");
  });
});

describe("job-board links to the real application page", async () => {
  const { findAtsLink, isAggregator } = await import("./discovery/resolve");
  it("finds the employer's ATS link in a board page, skipping whole boards", () => {
    const html = `<a href="https://boards.greenhouse.io/spacex">all jobs</a> "url":"https:\/\/boards.greenhouse.io\/spacex\/jobs\/8802897002?gh_jid=8802897002\\"`;
    expect(findAtsLink(html)).toBe("https://boards.greenhouse.io/spacex/jobs/8802897002?gh_jid=8802897002");
    expect(isAggregator("https://www.themuse.com/jobs/x")).toBe(true);
    expect(isAggregator("https://job-boards.greenhouse.io/x")).toBe(false);
  });
});

describe("security codes", async () => {
  const { waitForVerification } = await import("../../../agent/v2/mailcode");
  it("ignores a code from an earlier application and never reuses one", async () => {
    const submit = new Date("2026-11-08T00:40:00Z");
    const mail = (id: string, at: string, code: string) => ({ id, from: "Greenhouse <no-reply@greenhouse.io>", subject: "Security code for your application", date: new Date(at), body: async () => ({ text: `Your security code is ${code}`, html: "" }) });
    const box = { kind: "gmail-api", list: async () => [mail("old", "2026-11-08T00:39:20Z", "OLD12345"), mail("new", "2026-11-08T00:40:12Z", "NEW67890")], close: async () => {} };
    const got = await waitForVerification(async () => box as never, { since: submit, match: /greenhouse|code/i, want: "code", timeoutMs: 1000 });
    expect(got).toBe("NEW67890");
    const again = await waitForVerification(async () => box as never, { since: submit, match: /greenhouse|code/i, want: "code", timeoutMs: 50 });
    expect(again).toBeNull(); // already used
  }, 20000);
});
