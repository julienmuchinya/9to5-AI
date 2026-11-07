import { afterEach, describe, expect, it, vi } from "vitest";
import { countPipeline, resumeLabelOf, statsByResume } from "./pipeline";
import { needsKind } from "./needs";
import { extractLink } from "../../../agent/v2/mailcode";
import { boldRuns, renderClassicResume } from "./resume-render";
import { boldJobKeywords, pickResume, resumeJobScore } from "./resume-library";
import type { ParsedResume } from "./resume";

const bumps: { metric: string; by: number; scope?: string }[] = [];
vi.mock("./freeTier", () => ({
  FREE_LIMITS: { geminiRequestsPerMinute: 100000 },
  SAFETY_RATIO: 0.85,
  checkGemini: async () => ({ allowed: true }),
  readUsage: async () => 0,
  bumpUsage: async (_db: unknown, metric: string, by: number, scope?: string) => {
    bumps.push({ metric, by, scope });
    return 0;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  bumps.length = 0;
  delete process.env.GROQ_API_KEY;
});

describe("Gemini usage counting", () => {
  it("counts one request for a call that succeeded after retired/busy models, not every try", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.GEMINI_MODEL = "old-model";
    vi.stubGlobal("fetch", async (url: string) => {
      const model = url.split("/models/")[1].split(":")[0];
      if (model === "old-model") return new Response("gone", { status: 404 });
      if (model === "gemini-3.5-flash") return new Response("quota", { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 });
    });
    const { geminiGenerate } = await import("./gemini");
    await geminiGenerate({} as never, { contents: [{ role: "user", parts: [{ text: "hi" }] }], userId: "u1" });
    const req = bumps.filter((b) => b.metric === "gemini_requests");
    expect(req).toEqual([
      { metric: "gemini_requests", by: 1, scope: undefined },
      { metric: "gemini_requests", by: 1, scope: "u1" },
    ]);
  });

  it("sends JSON work to the backup AI when Gemini's quota is used up", async () => {
    process.env.GROQ_API_KEY = "g";
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("groq.com")) return new Response(JSON.stringify({ choices: [{ message: { content: '{"q1":"Yes"}' } }] }), { status: 200 });
      return new Response("quota", { status: 429 });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    const { geminiJson } = await import("./gemini");
    await expect(geminiJson({} as never, "answer")).resolves.toEqual({ q1: "Yes" });
    expect(bumps.some((b) => b.metric === "ai_groq_requests")).toBe(true);
    expect(bumps.some((b) => b.metric === "gemini_requests")).toBe(false); // the failed Gemini tries cost nothing
    vi.useRealTimers();
  }, 20000);
});

describe("pipeline counts (dashboard = applications page)", () => {
  it("counts every sent stage as sent and splits the rest", () => {
    const c = countPipeline([
      { status: "submitted", submitted_at: "x" },
      { status: "received", submitted_at: "x" },
      { status: "under_review", submitted_at: null },
      { status: "interview" },
      { status: "rejected" },
      { status: "needs_user" },
      { status: "queued" },
    ]);
    expect(c).toMatchObject({ total: 7, sent: 5, inReview: 2, interviews: 1, rejected: 1, needs: 1, queued: 1 });
  });

  it("attributes applications to the resume that was used", () => {
    expect(resumeLabelOf("AI resume · Python", ["Main resume", "AI resume"], "Main resume")).toBe("AI resume");
    expect(resumeLabelOf("Python", ["Main resume", "AI resume"], "Main resume")).toBe("Main resume");
    const s = statsByResume(
      [
        { status: "interview", submitted_at: "x", resume_focus: "AI resume · Python" },
        { status: "rejected", submitted_at: "x", resume_focus: "AI resume · Python" },
        { status: "submitted", submitted_at: "x", resume_focus: "Java" },
      ],
      ["Main resume", "AI resume"],
      "Main resume"
    );
    expect(s.get("AI resume")).toMatchObject({ sent: 2, progressed: 1, rejected: 1, rate: 0.5 });
    expect(s.get("Main resume")?.sent).toBe(1);
  });
});

describe("needs-you reasons", () => {
  it("groups the real error texts", () => {
    expect(needsKind("The agent can only submit verified Greenhouse, Lever and Ashby jobs — open this one and apply yourself")).toBe("manual");
    expect(needsKind("CAPTCHA appeared on submit — please submit this one yourself")).toBe("captcha");
    expect(needsKind("Your Workday account at ciena.wd5.myworkdayjobs.com isn't verified yet.")).toBe("signin");
    expect(needsKind("Submitted but no confirmation seen — please check")).toBe("check");
    expect(needsKind("anything", 2)).toBe("questions");
  });
});

describe("verification links", () => {
  it("finds a Workday activation link on the portal even without the word verify", () => {
    const html = `<a href="https://www.workday.com/privacy">Privacy</a><a href="https://ciena.wd5.myworkdayjobs.com/Careers/login/AbCdEfGhIjKlMnOpQrStUvWxYz12">Click here</a>`;
    expect(extractLink(html, "", "ciena.wd5.myworkdayjobs.com")).toBe("https://ciena.wd5.myworkdayjobs.com/Careers/login/AbCdEfGhIjKlMnOpQrStUvWxYz12");
  });
  it("still prefers an explicit verify link", () => {
    const html = `<a href="https://acme.wd1.myworkdayjobs.com/x/activate/token123">Verify</a>`;
    expect(extractLink(html, "", "acme.wd1.myworkdayjobs.com")).toContain("/activate/");
  });
});

const sample: ParsedResume = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  headline: "Open to Work Remotely | Hybrid or Relocate",
  education: [{ school: "State University", degree: "Bachelor’s Degree", field: "Software Engineering", graduation: "Dec 2026" }],
  experience: [
    { title: "Software Engineer", company: "Acme", location: "Remote", start: "Jan 2023", end: "Dec 2025", bullets: ["Built REST APIs in Python and React for 150+ users", "Set up CI/CD on AWS with Docker"] },
  ],
  skills: ["Python", "React", "AWS", "Docker", "Java"],
  skill_groups: [{ name: "Languages", items: ["Python", "Java"] }, { name: "Cloud", items: ["AWS", "Docker"] }],
  projects: [{ name: "Art Store", role: "Technical Specialist", org: "State University", date: "Fall 2025", tech: ["Java"], bullets: ["Delivered a **full-stack** store"] }],
};

describe("resume rendering and picking", () => {
  it("renders a one-page PDF in the classic layout", async () => {
    const pdf = await renderClassicResume(sample, { name: "Ada Lovelace", email: "ada@example.com", linkedin: "https://linkedin.com/in/ada" });
    expect(pdf).not.toBeNull();
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(pdf!)).getPageCount()).toBe(1);
  });
  it("gives up (so the original PDF is sent) when it can't fit on one page", async () => {
    const huge = { ...sample, experience: Array.from({ length: 12 }, () => sample.experience![0]).map((e) => ({ ...e, bullets: Array(6).fill("A long bullet ".repeat(12)) })) };
    expect(await renderClassicResume(huge, { name: "Ada" })).toBeNull();
  });
  it("parses **bold** runs", () => {
    expect(boldRuns("Did **this** well")).toEqual([
      { text: "Did ", bold: false },
      { text: "this", bold: true },
      { text: " well", bold: false },
    ]);
  });
  it("bolds the job's keywords only on bullets without bold of their own", () => {
    const out = boldJobKeywords(sample, "We need Python and AWS");
    expect(out.experience![0].bullets[0]).toContain("**Python**");
    expect(out.projects![0].bullets[0]).toBe("Delivered a **full-stack** store");
  });
  it("picks the resume that fits the job", () => {
    const embedded: ParsedResume = { ...sample, skills: ["C", "RTOS", "Embedded", "firmware"], experience: [{ title: "Firmware Intern", company: "Chips", bullets: ["Wrote embedded C firmware for an RTOS"] }] };
    const lib = { resumes: [{ id: "main", label: "Software", path: "a", parsed: sample, uploaded_at: "" }, { id: "x", label: "Embedded", path: "b", parsed: embedded, uploaded_at: "" }] };
    expect(pickResume(lib, "Embedded firmware engineer, C, RTOS")?.label).toBe("Embedded");
    expect(resumeJobScore(sample, "React Python developer")).toBeGreaterThan(resumeJobScore(embedded, "React Python developer"));
  });
});

describe("AI resume tailoring guard rails", () => {
  it("keeps the original bullet when the AI invents a number", async () => {
    process.env.GROQ_API_KEY = "g";
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ experience: [{ bullets: ["Built **REST APIs** for 9000 users", "Set up **CI/CD pipelines** on AWS with Docker"] }], projects: [{ bullets: ["Delivered a full-stack store"] }] }) } }],
        }),
        { status: 200 }
      )
    );
    const { aiTailorResume } = await import("./resume-library");
    const out = await aiTailorResume({} as never, sample, { title: "SWE", company: "X", description: "CI/CD" });
    expect(out.experience![0].bullets[0]).toBe(sample.experience![0].bullets[0]); // "9000" was invented → rejected
    expect(out.experience![0].bullets[1]).toBe("Set up **CI/CD pipelines** on AWS with Docker");
  });
});

describe("backup AI limits (same guard rails as Gemini)", () => {
  it("reads Groq's reset times", async () => {
    const { parseDuration } = await import("./fallback-ai");
    expect(parseDuration("1m26.4s")).toBe(86400);
    expect(parseDuration("577ms")).toBe(577);
    expect(parseDuration("7")).toBe(7000);
    expect(parseDuration(null)).toBe(0);
  });

  it("refuses a prompt too big for Groq's per-minute token limit instead of failing at Groq", async () => {
    process.env.GROQ_API_KEY = "g";
    let called = 0;
    vi.stubGlobal("fetch", async () => {
      called++;
      return new Response("{}", { status: 200 });
    });
    const { fallbackJson, PromptTooLargeError } = await import("./fallback-ai");
    await expect(fallbackJson({} as never, "x".repeat(40000))).rejects.toBeInstanceOf(PromptTooLargeError);
    expect(called).toBe(0);
  });

  it("moves to the next Groq model when one says its daily limit is reached", async () => {
    process.env.GROQ_API_KEY = "g";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const model = JSON.parse(init.body).model as string;
      seen.push(model);
      if (seen.length === 1) return new Response("rate limit: requests per day", { status: 429, headers: { "retry-after": "3600" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200 });
    });
    const { fallbackJson } = await import("./fallback-ai");
    await expect(fallbackJson({} as never, "hi")).resolves.toBe('{"ok":1}');
    expect(new Set(seen).size).toBe(2);
  });

  it("counts Gemini by the Pacific-time day (when Google resets it)", async () => {
    const { pacificDay } = await vi.importActual<typeof import("./freeTier")>("./freeTier");
    expect(pacificDay(new Date("2026-11-08T03:00:00Z"))).toBe("2026-11-07"); // 7 pm Pacific, still the 7th
    expect(pacificDay(new Date("2026-11-08T09:00:00Z"))).toBe("2026-11-08");
  });
});
