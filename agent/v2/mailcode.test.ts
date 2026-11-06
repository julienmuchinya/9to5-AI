import { describe, expect, it } from "vitest";
import { extractCode, extractLink, inboxErrorMessage } from "./mailcode";

describe("verification emails", () => {
  it("finds Greenhouse-style mixed-case codes", () => {
    expect(extractCode("Security code for your application to Acme\nCopy and paste this code into the security code field on your application: aB3dE5fG\nThanks")).toBe("aB3dE5fG");
  });
  it("finds numeric codes and skips years", () => {
    expect(extractCode("Your verification code is 482913. It expires in 10 minutes.")).toBe("482913");
    expect(extractCode("© 2026 Acme. Your one-time passcode: 7731")).toBe("7731");
  });
  it("never mistakes the company name in the subject for the code", () => {
    const mail = "Security code for your application to Hearst\nHi Ada, Copy and paste this code into the security code field on your application: kQ7xPz2R\nAfter you enter the code, resubmit your application.";
    expect(extractCode(mail)).toBe("kQ7xPz2R");
    expect(extractCode("Security code for your application to Hearst\nCopy and paste this code into the security code field: AbCdEfGh")).toBe("AbCdEfGh");
    expect(extractCode("Security code for your application to Hearst")).toBeNull();
  });
  it("returns null when there is no code", () => {
    expect(extractCode("Thanks for applying to Acme! We'll be in touch.")).toBeNull();
  });
  it("finds verify links but not unsubscribe links", () => {
    const html = `<a href="https://x.com/unsubscribe?u=1">Unsubscribe</a><a href="https://acme.wd5.myworkdayjobs.com/verify?token=abc&amp;x=1">Verify account</a>`;
    expect(extractLink(html)).toBe("https://acme.wd5.myworkdayjobs.com/verify?token=abc&x=1");
  });
  it("explains a rejected Gmail password", () => {
    expect(inboxErrorMessage({ message: "Command failed", responseText: "Invalid credentials (Failure)", authenticationFailed: true })).toMatch(/16-letter Gmail app password/);
  });
});

describe("connect with Google", () => {
  it("asks Google for read-only Gmail and a refresh token", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
    const { googleAuthUrl } = await import("../../src/lib/v2/gmail");
    const u = new URL(googleAuthUrl({ origin: "https://app.example", state: "s1", loginHint: "a@gmail.com" }));
    expect(u.hostname).toBe("accounts.google.com");
    expect(u.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(u.searchParams.get("scope")).not.toContain("https://mail.google.com/");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example/api/google/callback");
    expect(u.searchParams.get("state")).toBe("s1");
  });
  it("reads a code from whichever mailbox is connected", async () => {
    const { waitForVerification } = await import("./mailcode");
    let closed = false;
    const box = {
      kind: "gmail-api" as const,
      list: async () => [
        { id: "1", from: "Newsletter <news@x.com>", subject: "Weekly digest", date: new Date(), body: async () => ({ text: "code 999999", html: "" }) },
        { id: "2", from: "Greenhouse <no-reply@us.greenhouse-mail.io>", subject: "Security code for your application to Acme", date: new Date(), body: async () => ({ text: "Paste this code into the security code field: Xy7Kp2Qa", html: "" }) },
      ],
      close: async () => {
        closed = true;
      },
    };
    const code = await waitForVerification(async () => box, { since: new Date(), match: /greenhouse|security code/i, want: "code", timeoutMs: 1000 });
    expect(code).toBe("Xy7Kp2Qa");
    expect(closed).toBe(true);
  });
});
