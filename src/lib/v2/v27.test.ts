import { describe, expect, it } from "vitest";
import { isUsLocation, isUsRemote } from "./discovery/filters";
import { knownValue } from "../../../agent/v2/apply";

describe("US and US territories only", () => {
  it("accepts US states, cities and territories", () => {
    for (const l of ["Austin, TX", "New York, NY", "San Juan, Puerto Rico", "Hagatna, GU", "Saipan, Northern Mariana Islands", "Washington, DC", "United States"]) expect(isUsLocation(l)).toBe(true);
  });
  it("rejects other countries, even when a word like 'us' appears", () => {
    for (const l of ["Toronto, Ontario, Canada", "London, UK", "Bengaluru, India", "Manila, Philippines", "Lisbon, Portugal", "Mexico City, Mexico"]) expect(isUsLocation(l)).toBe(false);
  });
  it("keeps US towns that share a foreign name", () => {
    expect(isUsLocation("London, KY")).toBe(true);
    expect(isUsLocation("Paris, TX")).toBe(true);
  });
  it("remote: US or anywhere yes, another country no", () => {
    expect(isUsRemote("Remote - US")).toBe(true);
    expect(isUsRemote("Remote")).toBe(true);
    expect(isUsRemote("Remote - Canada")).toBe(false);
    expect(isUsRemote("Remote (Philippines)")).toBe(false);
    expect(isUsRemote("Remote, Argentina or Brazil")).toBe(false);
  });
});

describe("signature fields", () => {
  it("signs with the full name", () => {
    const f = { id: "f1", label: "Please type your name to electronically sign this document.", kind: "text", required: true, options: [], filled: false } as never;
    expect(knownValue(f, { first_name: "Ada", last_name: "Lovelace" } as never)).toBe("Ada Lovelace");
  });
});

describe("education section fields", async () => {
  const { knownValue, gradParts } = await import("../../../agent/v2/apply");
  const a = { first_name: "A", last_name: "B", graduation_date: "May 2027", education: [{ school: "State U", degree: "Bachelor's Degree", field: "Software Engineering", graduation: "May 2027" }] } as never;
  const f = (label: string, options: string[] = [], kind = "combobox") => ({ id: "x", label, kind, required: true, options, filled: false }) as never;
  it("reads graduation dates", () => {
    expect(gradParts("May 2027")).toEqual({ year: 2027, monthName: "May" });
    expect(gradParts("2026-12")).toEqual({ year: 2026, monthName: "December" });
  });
  it("fills Greenhouse education: degree, discipline, start and end dates", () => {
    expect(knownValue(f("Degree", ["High School", "Bachelor's Degree", "Master's Degree"]), a)).toBe("Bachelor's Degree");
    expect(knownValue(f("Discipline", ["Computer Science", "Software Engineering"]), a)).toBe("Software Engineering");
    expect(knownValue(f("End date year", ["2026", "2027", "2028"]), a)).toBe("2027");
    expect(knownValue(f("End date month"), a)).toBe("May");
    expect(knownValue(f("Start date year"), a)).toBe("2023");
  });
  it("doesn't answer questions that only mention a degree", () => {
    expect(knownValue(f("Do you have a Bachelor's degree?", ["Yes", "No"]), a)).not.toBe("Bachelor's Degree");
  });
});

describe("Greenhouse security codes are 8 characters", async () => {
  const { extractCode } = await import("../../../agent/v2/mailcode");
  const email = "Reference code 2026114 for your records. Copy and paste this code into the security code field on your application: aB3dE5fG";
  it("prefers the 8-character code when the site expects 8", () => {
    expect(extractCode(email, 8)).toBe("aB3dE5fG");
  });
  it("still finds ordinary 6-digit codes", () => {
    expect(extractCode("Your verification code is 482913")).toBe("482913");
  });
});
