import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailAuthError, gmailAccessToken, gmailAfter, gmailRaw, gmailSearch } from "./gmail";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Gmail API client", () => {
  it("swaps the refresh token for an access token", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("rt");
      expect(body.get("client_id")).toBe("cid");
      return json({ access_token: "at" });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await gmailAccessToken("rt")).toBe("at");
  });

  it("explains revoked access", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_grant" }, 400)));
    await expect(gmailAccessToken("rt")).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("searches and reads sender, subject and date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("messages?")) {
          expect(decodeURIComponent(url)).toContain("q=after:1700000000");
          return json({ messages: [{ id: "m1" }] });
        }
        return json({
          id: "m1",
          internalDate: "1700000100000",
          payload: { headers: [{ name: "From", value: "Greenhouse <no-reply@us.greenhouse-mail.io>" }, { name: "Subject", value: "Security code for your application" }] },
        });
      })
    );
    const found = await gmailSearch("at", gmailAfter(new Date(1700000000_000)), 5);
    expect(found).toEqual([{ id: "m1", from: "Greenhouse <no-reply@us.greenhouse-mail.io>", subject: "Security code for your application", date: new Date(1700000100000) }]);
  });

  it("decodes raw messages (base64url)", async () => {
    const raw = "Subject: Hi\r\n\r\nYour code: Ab3dE5fG";
    vi.stubGlobal("fetch", vi.fn(async () => json({ raw: Buffer.from(raw).toString("base64url") })));
    expect((await gmailRaw("at", "m1")).toString()).toBe(raw);
  });

  it("waits and retries when Gmail rate-limits instead of failing", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify({ error: { message: "Quota exceeded for quota metric 'Total Query Cost'" } }), { status: 403 });
        return json({ raw: Buffer.from("x").toString("base64url") });
      })
    );
    expect((await gmailRaw("at", "m1")).toString()).toBe("x");
    expect(calls).toBe(2);
  }, 10_000);
});
