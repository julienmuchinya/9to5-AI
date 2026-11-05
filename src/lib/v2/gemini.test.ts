import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./freeTier", () => ({
  FREE_LIMITS: { geminiRequestsPerMinute: 100000 },
  checkGemini: async () => ({ allowed: true }),
  bumpUsage: async () => {},
}));

afterEach(() => vi.unstubAllGlobals());

describe("geminiGenerate model fallback", () => {
  it("skips retired (404) and busy (503) models, then remembers the one that worked", async () => {
    process.env.GEMINI_API_KEY = "test";
    process.env.GEMINI_MODEL = "retired-model";
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const model = url.split("/models/")[1].split(":")[0];
      seen.push(model);
      if (model === "retired-model") return new Response("gone", { status: 404 });
      if (model === "gemini-3.5-flash") return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "hello" }] } }] }), { status: 200 });
    });
    const { geminiGenerate, geminiModels } = await import("./gemini");
    const out = await geminiGenerate({} as never, { contents: [{ role: "user", parts: [{ text: "hi" }] }] });
    expect(out.text).toBe("hello"); // reasoning parts are dropped
    expect(seen.slice(0, 3)).toEqual(["retired-model", "gemini-3.5-flash", "gemini-flash-latest"]);
    expect(geminiModels()[0]).toBe("gemini-flash-latest");
    expect(geminiModels()).not.toContain("retired-model");
  });

  it("reports a free-quota error when every model is rate-limited", async () => {
    vi.stubGlobal("fetch", async () => new Response("quota", { status: 429 }));
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    const { geminiGenerate, FreeTierLimitError } = await import("./gemini");
    await expect(geminiGenerate({} as never, { contents: [{ role: "user", parts: [{ text: "hi" }] }] })).rejects.toBeInstanceOf(FreeTierLimitError);
    vi.useRealTimers();
  }, 20000);
});
