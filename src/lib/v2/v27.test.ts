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
