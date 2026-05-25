import { describe, it, expect } from "vitest";
import { parseJobAlertEmail } from "./jobAlertParser";

describe("jobAlertParser", () => {
  it("parses mock LinkedIn-style alert", () => {
    const parsed = parseJobAlertEmail(
      "New job: Software Engineer Intern at Acme Tech",
      "Software Engineer Intern\nAcme Tech\nhttps://boards.greenhouse.io/acme/jobs/123\n\nRequired: Python\nRemote — US",
      "jobalerts-noreply@linkedin.com",
      "email-1"
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.companyName).toBe("Acme Tech");
    expect(parsed?.title).toContain("Software Engineer");
    expect(parsed?.source).toBe("linkedin_email");
    expect(parsed?.remoteType).toBe("remote");
  });

  it("blocks LinkedIn job page URLs", () => {
    const parsed = parseJobAlertEmail(
      "Job alert",
      "Role\nCo\nhttps://www.linkedin.com/jobs/view/12345\n",
      "jobalerts-noreply@linkedin.com",
      "email-2"
    );
    expect(parsed).toBeNull();
  });
});
