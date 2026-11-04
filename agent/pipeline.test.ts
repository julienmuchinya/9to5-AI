import { describe, it, expect, beforeEach } from "vitest";
import { runAgentPipeline } from "./pipeline";
import { getDefaultStore } from "../src/lib/store/default-store";

describe("9to5 AI agent pipeline Part 3", () => {
  beforeEach(() => {
    process.env.MOCK_MODE = "true";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GMAIL_REFRESH_TOKEN;
  });

  it("blocks all actions when emergency stop is on", async () => {
    const store = getDefaultStore();
    store.autopilot_settings.emergency_stop = true;
    const { summary, store: out } = await runAgentPipeline(store);
    expect(summary.emergency_stop).toBe(true);
    expect(summary.actions_blocked).toBe(true);
    expect(out.jobs.length).toBe(0);
  });

  it("does not call Gemini in mock mode", async () => {
    const store = getDefaultStore();
    store.autopilot_settings.emergency_stop = false;
    store.autopilot_settings.mock_mode = true;
    const { summary, store: out } = await runAgentPipeline(store);
    expect(summary.mock).toBe(true);
    expect(out.agent_usage_limits.ai_calls_today).toBe(0);
    const geminiLog = out.agent_logs.find((l) => l.message.includes("Calling Gemini"));
    expect(geminiLog).toBeUndefined();
    const skipLog = out.agent_logs.find((l) =>
      l.message.toLowerCase().includes("gemini") && l.message.toLowerCase().includes("mock")
    );
    expect(skipLog).toBeDefined();
  });

  it("skips duplicate jobs on second run", async () => {
    const store = getDefaultStore();
    store.autopilot_settings.emergency_stop = false;
    const first = await runAgentPipeline(store);
    const jobCount = first.store.jobs.length;
    const second = await runAgentPipeline(first.store);
    expect(second.store.jobs.length).toBe(jobCount);
    expect(second.summary.duplicates).toBeGreaterThan(0);
  });

  it("logs pipeline steps with step metadata", async () => {
    const store = getDefaultStore();
    store.autopilot_settings.emergency_stop = false;
    const { store: out } = await runAgentPipeline(store);
    const messages = out.agent_logs.map((l) => l.message);
    expect(messages.some((m) => m.includes("agent run started"))).toBe(true);
    expect(messages.some((m) => m.includes("Scanned") || m.includes("Gmail"))).toBe(true);
    expect(messages.some((m) => m.includes("Decision:"))).toBe(true);
    expect(messages.some((m) => m.includes("agent run completed"))).toBe(true);
  });

  it("saves jobs but does not submit applications", async () => {
    const store = getDefaultStore();
    store.autopilot_settings.emergency_stop = false;
    const beforeApps = store.applications.length;
    const { summary, store: out } = await runAgentPipeline(store);
    expect(summary.applications_submitted).toBe(0);
    expect(summary.outreach_sent).toBe(0);
    expect(out.applications.length).toBe(beforeApps);
    expect(out.jobs.length).toBeGreaterThan(0);
  });

  it("ingests mock email and company jobs", async () => {
    const store = getDefaultStore();
    store.autopilot_settings.emergency_stop = false;
    const { summary } = await runAgentPipeline(store);
    expect(summary.jobs_found).toBeGreaterThan(0);
    expect(summary.jobs_saved).toBeGreaterThan(0);
  });

  it("logs blocked actions when company scan blocks", async () => {
    const store = getDefaultStore();
    store.autopilot_settings.emergency_stop = false;
    store.companies.push({
      id: "bad-co",
      name: "Bad Co",
      career_url: "https://www.linkedin.com/jobs/view/123",
      trust_score: 50,
      scan_enabled: true,
    });
    const { store: out } = await runAgentPipeline(store);
    const blocked = out.blocked_actions.some((b) =>
      b.reason_code.includes("BLOCKED") || b.reason_detail?.includes("linkedin")
    );
    expect(blocked || out.agent_logs.some((l) => l.message.includes("blocked"))).toBe(true);
  });
});
