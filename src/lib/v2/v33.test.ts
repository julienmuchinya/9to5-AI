import { describe, expect, it } from "vitest";
import { classifyEmail } from "./tracking";

// "Thanks for applying" emails that describe what MIGHT happen next were being read as interviews/screenings.
describe("application-received emails are not interviews", () => {
  const received: [string, string][] = [
    ["Thank you for applying to Acme Semiconductor", "Thank you for applying for the AI Application Engineer Intern position. If we determine your qualifications match, we will invite you to interview with the team."],
    ["Acme | Thanks for Applying!", "Thanks for applying! Once we've reviewed your application, we'd love to schedule a call to learn more about you."],
    ["Thank you for applying to Acme Corporation!", "We've received your application. The next step is a phone screen with a recruiter, who will reach out to schedule a time."],
    ["Thank you for applying to the Analyst position at Acme!", "Our team will review your application. Should we decide to move forward, we would like to invite you to a phone interview."],
    ["Thank you for applying to Acme", "We'll review your application and, if there's a fit, a recruiter will reach out to set up an introductory call."],
    ["We've got it! Your application for Research Intern at Acme is underway", "Next round: if you're selected, we'll invite you to an online assessment."],
    ["Thank you for applying", "Our process: a recruiter screen, a technical interview, then a final round with the hiring manager. We look forward to reviewing your application."],
    ["Thank you for your interest in the Specialist position with Acme", "We are reviewing your application and will contact you if your experience matches the role."],
    ["Julien, we have received your application", "Hiring managers will review it. Candidates who move forward will be contacted to schedule an interview."],
    ["Application received", "In the meantime, you can prepare for your interview with our candidate guide and see what to expect in a technical interview."],
  ];
  for (const [subject, body] of received) {
    it(subject, () => expect(classifyEmail(subject, body, "Acme Talent <noreply@myworkday.com>")).toBe("received"));
  }

  it("a confirmation with a real booking link is still an invitation", () => {
    expect(classifyEmail("Thanks for applying to Acme", "Thanks for applying! We'd like to invite you to a phone screen. Please pick a time: calendly.com/acme-recruiting")).toBe("screening");
    expect(classifyEmail("Thank you for applying", "Your interview is scheduled for Tuesday at 2pm with the hiring manager.")).toBe("interview");
    expect(classifyEmail("Thank you for applying", "Please complete the assessment within 5 days: codesignal link inside.")).toBe("screening");
  });

  it("'let us know if you're available' is still a real ask", () => {
    expect(classifyEmail("Quick chat?", "We'd love to set up a call with you. Let us know if you are available Thursday.")).toBe("screening");
  });

  it("a non-confirmation 'if' sentence doesn't make an interview", () => {
    expect(classifyEmail("Update on your application", "If we decide to move forward, we will invite you to interview.")).toBeNull();
  });
});
