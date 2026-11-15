import { describe, expect, it } from "vitest";
import { digitsOnly, friendlyAuthError, safeNext, siteOrigin } from "./site";

describe("digitsOnly", () => {
  // Regression: the code fields used /D/g (strips the letter "D") instead of /\D/g,
  // so a pasted "123 456" kept its space and failed verification.
  it("keeps only digits from pasted codes", () => {
    expect(digitsOnly("123 456")).toBe("123456");
    expect(digitsOnly("12-34-56")).toBe("123456");
    expect(digitsOnly("Code: 654321\n")).toBe("654321");
    expect(digitsOnly("DDD")).toBe("");
  });
});

describe("siteOrigin", () => {
  it("uses the address the person is on, not localhost", () => {
    expect(siteOrigin(new Headers({ origin: "https://9to5-ai-julienmuchinyas-projects.vercel.app" }))).toBe("https://9to5-ai-julienmuchinyas-projects.vercel.app");
    expect(siteOrigin(new Headers({ "x-forwarded-host": "app.example.com" }))).toBe("https://app.example.com");
    expect(siteOrigin(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
  });
});

describe("safeNext", () => {
  it("allows our own pages only", () => {
    expect(safeNext("/jobs?show=all")).toBe("/jobs?show=all");
    expect(safeNext("//evil.com")).toBe("/dashboard");
    expect(safeNext("https://evil.com")).toBe("/dashboard");
    expect(safeNext("/\\evil.com")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
  });
});

describe("friendlyAuthError", () => {
  it("explains common auth failures", () => {
    expect(friendlyAuthError("Email link is invalid or has expired", "otp_expired")).toMatch(/expired/);
    expect(friendlyAuthError("Invalid login credentials")).toMatch(/Wrong email or password/);
    expect(friendlyAuthError("Email not confirmed")).toMatch(/confirmed/);
    expect(friendlyAuthError("For security purposes, you can only request this after 42 seconds")).toMatch(/Too many/);
  });
});
