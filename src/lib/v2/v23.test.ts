import { describe, expect, it } from "vitest";
import { commonSenseAnswer, questionFor } from "./app-questions";
import { SUCCESS, applyUrlFor, knownValue, type Applicant, type Field } from "../../../agent/v2/apply";

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

describe('round 3: real-form mistakes', () => {
  const withLinks: Applicant = { ...me, linkedin_url: 'https://linkedin.com/in/ada', answers: { work_mode: 'Remote, hybrid or onsite' } };
  it('does not paste the LinkedIn URL into "how did you hear"', () => {
    expect(knownValue(f('How did you hear about us? (LinkedIn, job board, recruiter outreach, employee referral, etc.)', 'textarea'), withLinks)).toBe('LinkedIn');
    expect(knownValue(f('LinkedIn URL', 'text'), withLinks)).toBe('https://linkedin.com/in/ada');
  });
  it('a long label is classified by its start, not by tooltip text further on', () => {
    expect(questionFor('Race' + ' '.repeat(5) + 'x'.repeat(200) + ' Hispanic or Latino: a person of Cuban, Mexican…')?.key).toBe('race');
  });
  it('leaves commute-distance questions to the AI (it knows both locations)', () => {
    expect(knownValue(f('This role requires at least 3 days a week in the office, are you able to easily commute to the location the role is based in?', 'select', ['Yes', 'No']), withLinks)).toBeNull();
  });
  it('answers N/A to follow-ups whose condition does not apply', () => {
    expect(commonSenseAnswer('If you selected “Yes” to requiring sponsorship now or in the future, please specify your current visa', [], 'textarea')).toBe('N/A');
  });
});

describe('confirmation screens', () => {
  it('recognises the wording each ATS uses', () => {
    for (const t of ['Thanks so much for applying to join us at Quora!', 'Thank you for applying.', 'Application submitted!', 'Thanks for applying to Shield AI', 'Your application was successfully submitted', 'We have received your application', "We've received your application"])
      expect(SUCCESS.test(t), t).toBe(true);
    expect(SUCCESS.test('Submit application')).toBe(false);
    expect(SUCCESS.test('Apply for this job')).toBe(false);
  });
});

describe('Workday contact fields', () => {
  const a: Applicant = { ...me, phone: '(+1) 555-010-0199', city: 'Atlanta', state: 'Georgia' };
  it('only the phone NUMBER field gets the number', () => {
    expect(knownValue(f('Phone Number', 'text'), a)).toBe('(+1) 555-010-0199');
    expect(knownValue(f('Phone Device Type', 'combobox', ['Mobile', 'Home']), a)).toBe('Mobile');
    expect(knownValue(f('Country Phone Code', 'combobox', ['Canada (+1)', 'United States of America (+1)']), a)).toBe('United States of America (+1)');
    expect(knownValue(f('Phone Extension', 'text'), a)).toBeNull();
  });
  it('City gets the city, Location gets city and state', () => {
    expect(knownValue(f('City', 'text'), a)).toBe('Atlanta');
    expect(knownValue(f('Location - City and State of Residence', 'text'), a)).toBe('Atlanta, Georgia');
  });
});

describe('more real-form fixes', () => {
  it('never puts the email address into a consent dropdown', () => {
    const label = 'Assurant will contact you about your application by email and/or phone. If you provide your consent below, we will also send you SMS/MMS messages';
    const v = knownValue(f(label, 'combobox', ['Yes', 'No']), { ...me, email: 'a@b.c' });
    expect(v).not.toBe('a@b.c');
    expect(v).toBe('No');
  });
  it('reuses a pay answer given under different wording', () => {
    const a: Applicant = { ...me, custom: { 'desired pay': '90000' } };
    expect(knownValue(f('What is your expected compensation?', 'text'), a)).toBe('90000');
  });
});

describe('fields about other things or other people', () => {
  const a: Applicant = { ...me, email: 'me@x.com', github_url: 'https://github.com/me' };
  it('a question mentioning "website" is not the website field', () => {
    expect(knownValue(f("Have You Been Previously Employed By KLA? (If you're a current KLA employee, please do NOT use this application process. Apply on our internal website.)", 'radio', ['Yes', 'No']), a)).not.toBe('https://github.com/me');
    expect(knownValue(f('Portfolio URL', 'text'), a)).toBe('https://github.com/me');
  });
  it("the referrer's email is not mine", () => {
    expect(knownValue(f("What's their name or email address?", 'text'), a)).toBeNull();
    expect(knownValue(f('Email', 'text'), a)).toBe('me@x.com');
  });
});

describe('application URLs and degrees', () => {
  it('adds the form path without breaking a query string', () => {
    expect(applyUrlFor('ashby', 'https://jobs.ashbyhq.com/rhoda-ai/9a57?embed=true')).toBe('https://jobs.ashbyhq.com/rhoda-ai/9a57/application?embed=true');
    expect(applyUrlFor('ashby', 'https://jobs.ashbyhq.com/x/1/application')).toBe('https://jobs.ashbyhq.com/x/1/application');
    expect(applyUrlFor('lever', 'https://jobs.lever.co/acme/abc')).toBe('https://jobs.lever.co/acme/abc/apply');
  });
  it('picks the plain bachelor option for degree dropdowns', () => {
    expect(commonSenseAnswer('Degree', ['Select One', 'High School Diploma or Equivalent', 'Bachelor of Science with Honors', 'Bachelor of Science', 'Master of Science'], 'combobox')).toBe('Bachelor of Science');
  });
});

describe('statement-style yes/no options', () => {
  const opts = ['I am authorized to work in the United States for any employer', 'I am authorized to work in the United States for my present employer only', 'I require sponsorship to work in the United States', 'I am not authorized to work in the United States', 'My status to work in the United States is unknown'];
  it('authorization picks the unqualified statement', () => {
    expect(knownValue(f('Are you legally authorized to work in the United States?', 'combobox', opts), me)).toBe('I am authorized to work in the United States for any employer');
  });
  it('sponsorship No picks the negative statement', () => {
    const o = ['Yes, I will require sponsorship', 'No, I will not require sponsorship'];
    expect(knownValue(f('Will you require visa sponsorship now or in the future?', 'select', o), me)).toBe('No, I will not require sponsorship');
    expect(knownValue(f('Will you require visa sponsorship now or in the future?', 'select', ['I will require sponsorship', 'I do not require sponsorship']), me)).toBe('I do not require sponsorship');
  });
});

describe('school field', () => {
  const a: Applicant = { ...me, school: 'Example State University' };
  it('only where a school is asked for', () => {
    expect(knownValue(f('School', 'combobox'), a)).toBe('Example State University');
    expect(knownValue(f('Have you ever worked at The American College of Obstetricians and Gynecologists or any of its affiliates?', 'combobox', ['Yes', 'No']), a)).not.toBe('Example State University');
  });
});

describe('clearance and previous employment', () => {
  it('no clearance', () => {
    expect(commonSenseAnswer('Please list the type of clearance held:', [], 'text')).toBe('None');
    expect(commonSenseAnswer('What level Clearance do you possess?', ['Top Secret', 'Secret', 'None'], 'combobox')).toBe('None');
    expect(commonSenseAnswer('Are you willing to obtain a security clearance?', ['Yes', 'No'], 'radio')).toBeNull();
  });
  it('never worked here before', () => {
    expect(commonSenseAnswer('Have you previously worked for this organization? If Yes, please provide dates', [], 'text')).toBe('No');
    expect(commonSenseAnswer('Have you previously been employed by Leidos?', ['Yes', 'No'], 'radio')).toBe('No');
  });
});
