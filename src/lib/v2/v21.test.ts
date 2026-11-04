import { beforeAll, describe, expect, it } from "vitest";
import { checkAnswer, decoyQuestions, decryptSecret, encryptSecret, generatePortalPassword, hashAnswer } from "./vault";
import { classifyEmail, emailMentionsCompany, nextStatus, roleFamily } from "./tracking";

beforeAll(() => {
  process.env.VAULT_KEY = "a".repeat(64);
});

describe("vault", () => {
  it("encrypts and decrypts, with a fresh IV each time", () => {
    const a = encryptSecret("Hunter2!xyz");
    const b = encryptSecret("Hunter2!xyz");
    expect(a).not.toBe(b);
    expect(a).not.toContain("Hunter2");
    expect(decryptSecret(a)).toBe("Hunter2!xyz");
  });
  it("rejects tampered ciphertext", () => {
    const a = encryptSecret("secret");
    const parts = a.split(":");
    parts[3] = Buffer.from("other").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
  it("generates portal passwords that pass common rules", () => {
    for (let i = 0; i < 20; i++) {
      const p = generatePortalPassword();
      expect(p).toHaveLength(18);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[!@#$%*?]/);
    }
  });
});

describe("security answers", () => {
  it("ignores case, spaces and punctuation, but not different words", () => {
    const h = hashAnswer("Mr. Fluffy");
    expect(h).not.toContain("fluffy");
    expect(checkAnswer("  mr fluffy!! ", h)).toBe(true);
    expect(checkAnswer("fluffy", h)).toBe(false);
  });
  it("gives stable decoy questions for unknown emails", () => {
    const a = decoyQuestions("nobody@example.com");
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(decoyQuestions("nobody@example.com")).toEqual(a);
  });
});

describe("tracking", () => {
  it("classifies recruiter emails", () => {
    expect(classifyEmail("Your application to Acme", "Unfortunately, we have decided to move forward with other candidates.")).toBe("rejected");
    expect(classifyEmail("Next steps", "We'd love to schedule an interview with you next week.")).toBe("interview");
    expect(classifyEmail("Thank you for applying!", "We have received your application for Software Engineer Intern.")).toBe("received");
    expect(classifyEmail("Offer", "We are pleased to extend an offer for the position.")).toBe("offer");
    expect(classifyEmail("50% off shoes", "Big sale this weekend")).toBeNull();
  });
  it("only moves statuses forward", () => {
    expect(nextStatus("interview", "received")).toBe("interview");
    expect(nextStatus("submitted", "interview")).toBe("interview");
    expect(nextStatus("interview", "rejected")).toBe("rejected");
    expect(nextStatus("rejected", "interview")).toBe("rejected");
  });
  it("matches emails to companies", () => {
    expect(emailMentionsCompany("Stripe, Inc.", "Stripe Recruiting <no-reply@stripe.com>", "Update", "")).toBe(true);
    expect(emailMentionsCompany("Acme Labs", "jobs@greenhouse.io", "Your application to Acme", "")).toBe(true);
    expect(emailMentionsCompany("Acme Labs", "deals@shop.com", "Weekly deals", "")).toBe(false);
  });
  it("groups role families", () => {
    expect(roleFamily("Machine Learning Engineer Intern")).toBe("AI / ML");
    expect(roleFamily("Backend Software Engineer")).toBe("Backend");
    expect(roleFamily("Data Analyst")).toBe("Data");
  });
});
