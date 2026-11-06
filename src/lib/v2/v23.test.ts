import { describe, expect, it } from "vitest";
import { commonSenseAnswer } from "./app-questions";
import { knownValue, type Applicant, type Field } from "../../../agent/v2/apply";

const me: Applicant = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  resume_text: "",
  work_authorized_us: true,
  sponsorship_needed: false,
};
const f = (label: string, kind: Field["kind"] = "select", options: string[] = []): Field => ({ id: "f1", label, kind, required: true, options });

describe("common sense answers", () => {
  it("never claims a referral when asked how you heard about the job", () => {
    const opts = ["Referral", "LinkedIn - Job Posting", "LinkedIn - Employee Post", "Company website", "Other"];
    expect(commonSenseAnswer("Where did you hear about this internship?", opts, "select")).toBe("LinkedIn - Job Posting");
    expect(commonSenseAnswer("How did you hear about us?", ["Referral", "Indeed", "Other"], "select")).toBe("Indeed");
    expect(commonSenseAnswer("How did you hear about us?", [], "text")).toBe("LinkedIn");
  });
  it("says No to knowing employees or being referred", () => {
    expect(commonSenseAnswer("Do you know anyone who has been or is still employed by our organization?", ["Yes", "No"], "combobox")).toBe("No");
    expect(commonSenseAnswer("Were you referred by a current employee?", ["Yes", "No"], "radio")).toBe("No");
  });
  it("uses sensible text defaults", () => {
    expect(commonSenseAnswer("What are your salary expectations? (Hourly rate)", [], "text")).toBe("Negotiable");
    expect(commonSenseAnswer("What is your notice period?", [], "text")).toBe("2 weeks");
  });
  it("accepts required consents but not marketing texts", () => {
    expect(commonSenseAnswer("I acknowledge that I have read the privacy notice", [], "checkbox")).toBe("yes");
    expect(commonSenseAnswer("I agree to receive text messages about future opportunities", [], "checkbox")).toBeNull();
  });
  it("leaves sensitive questions alone", () => {
    expect(commonSenseAnswer("Do you have a disability?", ["Yes", "No", "I don't wish to answer"], "select")).toBeNull();
    expect(commonSenseAnswer("Have you ever been convicted of a felony?", ["Yes", "No"], "radio")).toBeNull();
  });
});

describe("sponsorship asked without the word 'sponsor'", () => {
  it("answers petition / immigration-status questions from the profile", () => {
    const label =
      "Will you now or in the future require our company to file a petition or application for employment - based immigration status on your behalf to begin or continue employment with our company?";
    expect(knownValue(f(label, "select", ["Yes", "No"]), me)).toBe("No");
  });
  it("still leaves 'please confirm' notices alone", () => {
    expect(knownValue(f("Sponsorship is not available for this role. Please confirm you understand.", "select", ["Yes", "No"]), me)).toBeNull();
  });
});
