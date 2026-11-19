import { describe, expect, it } from "vitest";
import { classifyEmail, emailMentionsCompany, gmailLink, statusFromEvents, titleOverlap } from "./tracking";
import { jobBrief } from "./job-brief";
import { autoFollowUpAnswer, isFollowUp, questionContext } from "./app-questions";
import { isBadPasswordError } from "../../../agent/v2/workday";

describe("email stages don't invent progress", () => {
  it("a confirmation that mentions a possible interview is only 'received'", () => {
    const body =
      "Thank you for applying to the Data Analyst role. We have received your application. If your background matches what we're looking for, a recruiter will contact you to schedule an interview.";
    expect(classifyEmail("Thank you for your application", body)).toBe("received");
  });
  it("'our process typically includes a phone screen' is not a screening", () => {
    expect(classifyEmail("Application received", "We've received your application. Our hiring process typically includes a phone screen and a technical interview.")).toBe("received");
  });
  it("'unfortunately we can't reply to everyone' is not a rejection", () => {
    expect(classifyEmail("Thanks for applying", "Thanks for applying! Unfortunately, due to the high volume we are unable to respond to every applicant individually.")).toBe("received");
  });
  it("job boards and alerts are ignored", () => {
    expect(classifyEmail("Interview invitation tips", "Schedule an interview with top companies", "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>")).toBeNull();
    expect(classifyEmail("New jobs for you: Data Analyst", "Acme is hiring. Apply now.")).toBeNull();
  });
  it("real invitations still count", () => {
    expect(classifyEmail("Next steps with Acme", "We'd like to invite you to a phone screen with our recruiter. Please pick a time: calendly.com/acme")).toBe("screening");
    expect(classifyEmail("Interview invitation", "We'd like to invite you to a technical interview with the team")).toBe("interview");
    expect(classifyEmail("Thanks for applying", "We received your application and we'd like to invite you to interview — please select a time that works.")).toBe("interview");
    expect(classifyEmail("Availability", "Are you available for a call this week? Let us know if you are available Tuesday.")).toBe("screening");
  });
  it("real rejections still count", () => {
    expect(classifyEmail("Your application", "Unfortunately, we have decided to move forward with other candidates.")).toBe("rejected");
    expect(classifyEmail("Update", "We regret to inform you that the position has been filled.")).toBe("rejected");
  });
  it("a newsletter naming the company in the body doesn't count", () => {
    expect(emailMentionsCompany("Acme", "Careers Weekly <news@careers.example>", "This week's top employers", "Acme, Globex and Initech are hiring")).toBe(false);
    expect(emailMentionsCompany("Acme", "Acme via Greenhouse <no-reply@us.greenhouse-mail.io>", "Update on your application", "Thank you for applying to Acme")).toBe(true);
  });
  it("picks the application whose title the email names", () => {
    expect(titleOverlap("Data Analyst", "Your Data Analyst application", "")).toBeGreaterThan(titleOverlap("Software Engineer", "Your Data Analyst application", ""));
  });
  it("rebuilds the status after a wrong event is removed", () => {
    expect(statusFromEvents("submitted", ["submitted", "received"])).toBe("received");
    expect(statusFromEvents("submitted", ["submitted", "received", "interview", "rejected"])).toBe("rejected");
  });
  it("links straight to the email", () => {
    expect(gmailLink("me@gmail.com", "18c2f3a4b5c6d7e8", null)).toBe("https://mail.google.com/mail/u/?authuser=me%40gmail.com#all/18c2f3a4b5c6d7e8");
    expect(gmailLink("me@gmail.com", "<abc@mail.acme.com>", null)).toContain("rfc822msgid%3Aabc%40mail.acme.com");
    expect(gmailLink(null, null, "Interview with Acme")).toContain("subject%3A%22Interview%20with%20Acme%22");
  });
});

describe("password resets only on a real refusal", () => {
  it("reads only the sign-in error", () => {
    expect(isBadPasswordError("Wrong email or password.")).toBe(true);
    expect(isBadPasswordError("Invalid email or password")).toBe(true);
    expect(isBadPasswordError("")).toBe(false);
    expect(isBadPasswordError("Please verify your email address before signing in")).toBe(false);
    expect(isBadPasswordError("Invalid date format in field Start Date")).toBe(false);
  });
});

describe("job brief", () => {
  it("splits summary, requirements and nice-to-haves", () => {
    const b = jobBrief(
      "We're looking for a Data Analyst to join our growing finance team. You will build dashboards that leadership relies on.\nResponsibilities:\nBuild weekly reports\nPartner with finance\nRequirements:\n3+ years of experience with SQL\nBachelor's degree in a quantitative field\nPreferred qualifications\nExperience with Tableau\nBenefits\nHealth insurance"
    );
    expect(b.summary).toMatch(/Data Analyst/);
    expect(b.requirements).toEqual(["3+ years of experience with SQL", "Bachelor's degree in a quantitative field"]);
    expect(b.niceToHave).toEqual(["Experience with Tableau"]);
    expect(b.responsibilities).toContain("Build weekly reports");
    expect(b.facts).toContain("3+ years of experience");
    expect(b.requirements.join(" ")).not.toMatch(/Health insurance/);
  });
  it("copes with an empty description", () => {
    expect(jobBrief(null).requirements).toEqual([]);
  });
});

describe("follow-up questions", () => {
  const fields = [
    { id: "a", label: "Have you worked for Acme before?", kind: "radio" },
    { id: "b", label: "If yes, please explain", kind: "textarea" },
  ];
  it("knows a follow-up", () => {
    expect(isFollowUp("If yes, please explain")).toBe(true);
    expect(isFollowUp("Please specify")).toBe(true);
    expect(isFollowUp("What is your desired salary?")).toBe(false);
  });
  it("shows the question it follows", () => {
    expect(questionContext(fields, "b", { a: "Yes" })).toEqual([{ label: "Have you worked for Acme before?", answer: "Yes" }]);
    expect(questionContext(fields, "a", {})).toBeUndefined();
  });
  it("answers N/A when the condition wasn't met", () => {
    expect(autoFollowUpAnswer(fields, "b", { a: "No" })).toBe("N/A");
    expect(autoFollowUpAnswer(fields, "b", { a: "Yes" })).toBeNull();
  });
});
