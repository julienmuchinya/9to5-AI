import { describe, it, expect } from "vitest";
import { scoreResumeTemplates } from "./resume-selector";

describe("resume selector", () => {
  it("picks backend template for backend JD", () => {
    const templates = [
      { id: "1", name: "Backend", slug: "backend", content: "Java Python FastAPI REST APIs backend", skills: ["python", "java"], is_active: true },
      { id: "2", name: "Frontend", slug: "frontend", content: "React TypeScript UI frontend", skills: ["react"], is_active: true },
    ];
    const scored = scoreResumeTemplates("Required: Python, Java, REST APIs. Backend developer intern.", templates);
    expect(scored[0].templateName).toBe("Backend");
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });
});
