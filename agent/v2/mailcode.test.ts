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
