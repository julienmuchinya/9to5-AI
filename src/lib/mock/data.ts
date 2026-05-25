import { APP_NAME } from "../constants";
import type { EvidenceItem } from "../types";

export const MOCK_USER_ID = "00000000-0000-4000-8000-000000000001";

export const MOCK_PROFILE = {
  full_name: "Ada Lovelace",
  school: "Example State University",
  job_email: "jobs@example.com",
  location_preference: "us_nationwide",
  work_mode: "flexible",
  relocation: true,
  sponsorship_needed: false as boolean,
  target_roles: [
    "Software Engineer Intern",
    "Backend Developer Intern",
    "Cloud Engineer Intern",
  ],
  skills: [
    "Java", "Python", "React", "PostgreSQL", "SQL", "Flask", "FastAPI",
    "Firebase", "REST APIs", "Spring Boot",
  ],
};

export const MOCK_EVIDENCE: EvidenceItem[] = [
  {
    category: "project",
    title: "QuickNotes",
    content:
      "Full-stack notes web app using React, Firebase Authentication, protected routes, and cloud deployment.",
    skills: ["React", "Firebase", "JavaScript"],
    tools: ["Firebase", "React"],
    approved: true,
  },
  {
    category: "project",
    title: "Skidder Ride Share",
    content:
      "Ride-sharing platform concept with Flutter, NestJS, PostgreSQL, AWS, Socket.IO, Redis, Docker, CI/CD.",
    skills: ["NestJS", "PostgreSQL", "AWS", "Docker"],
    tools: ["PostgreSQL", "AWS", "Docker", "Redis"],
    approved: true,
  },
  {
    category: "project",
    title: "Clara SaaS Invoicing",
    content:
      "Multi-tenant SaaS invoicing with Stripe webhooks, Flask API, Node.js, Firestore, OpenAI features.",
    skills: ["Flask", "Python", "Stripe", "Multi-tenant"],
    tools: ["Flask", "Stripe", "Firestore"],
    approved: true,
  },
  {
    category: "work",
    title: "Walmart — Cashier & Online Order Coordinator",
    content: "Customer service, order coordination, reliability under pressure.",
    skills: ["Communication", "Operations"],
    approved: true,
  },
  {
    category: "work",
    title: "Roadie — Driver",
    content: "Independent delivery driver; time management and logistics.",
    skills: ["Logistics", "Time management"],
    approved: true,
  },
  {
    category: "education",
    title: "Example State University — Software Engineering",
    content: "Coursework in Java, Python, databases, web development, cloud basics.",
    skills: ["Java", "Python", "SQL", "Software Engineering"],
    approved: true,
  },
  {
    category: "skill",
    title: "Java",
    content: "Used in coursework and Spring Boot basics.",
    skills: ["Java"],
    proof: "University coursework + Spring Boot project",
    approved: true,
  },
  {
    category: "skill",
    title: "Python",
    content: "Flask, FastAPI projects and coursework.",
    skills: ["Python", "Flask", "FastAPI"],
    approved: true,
  },
  {
    category: "skill",
    title: "React",
    content: "QuickNotes and frontend coursework.",
    skills: ["React", "JavaScript"],
    approved: true,
  },
  {
    category: "skill",
    title: "PostgreSQL",
    content: "Skidder and Clara projects; SQL coursework.",
    skills: ["PostgreSQL", "SQL"],
    approved: true,
  },
];

export const MOCK_JOB_ALERT = {
  subject: `${APP_NAME} Mock — Software Engineer Intern at Acme Tech`,
  from: "jobalerts-noreply@linkedin.com",
  body: `New job match!\n\nSoftware Engineer Intern\nAcme Tech\nhttps://boards.greenhouse.io/acme/jobs/123\n\nRequired: Python, React, REST APIs\nPreferred: PostgreSQL, Docker\n\nRemote — US`,
};

export const MOCK_JOB_ALERTS_EXTRA = [
  {
    subject: `${APP_NAME} Mock — Backend Intern at CloudBase Inc`,
    from: "noreply@joinhandshake.com",
    body: `New internship posting\n\nBackend Intern\nCloudBase Inc\nhttps://jobs.lever.co/cloudbase/backend-intern\n\nRequired: Python, PostgreSQL, REST APIs\nPreferred: Docker, AWS\n\nHybrid — Atlanta, GA`,
  },
  {
    subject: `${APP_NAME} Mock — SWE Intern at Acme Tech (duplicate title)`,
    from: "noreply@simplify.jobs",
    body: `Simplify alert\n\nSoftware Developer Intern\nAcme Tech\nhttps://boards.greenhouse.io/acme/jobs/123\n\nRequired: Python, React\n\nRemote`,
  },
];

export const MOCK_COMPANY_JOBS = [
  {
    companyName: "Acme Tech",
    title: "Cloud Engineer Intern",
    url: "https://boards.greenhouse.io/acme/jobs/456",
    location: "Remote — US",
    department: "Engineering",
    description: "Cloud intern role. Required: AWS basics, Python. Preferred: Docker.",
    source: "career_greenhouse",
  },
  {
    companyName: "CloudBase Inc",
    title: "Full Stack Intern",
    url: "https://jobs.lever.co/cloudbase/fullstack-intern",
    location: "Hybrid — Atlanta",
    department: "Product Engineering",
    description: "Full stack intern. Required: React, Node, SQL.",
    source: "career_lever",
  },
];

export const MOCK_GEMINI_RESPONSE = {
  fitSummary: "Strong match for intern SWE role based on React and Python projects.",
  tailoredBullets: [
    "Built QuickNotes full-stack app with React and Firebase",
    "Developed APIs with Flask and FastAPI in coursework and Clara project",
  ],
};

export const MOCK_COMPANIES = [
  { name: "Acme Tech", domain: "acmetech.com", career_url: "https://acmetech.com/careers", trust_score: 88 },
  { name: "CloudBase Inc", domain: "cloudbase.io", career_url: "https://cloudbase.io/jobs", trust_score: 90 },
];

export const MOCK_RESUME_CONTENT = (name: string) =>
  `${name}\nAda Lovelace | Software Engineering Student\n\nSKILLS: Java, Python, React, PostgreSQL, Flask, FastAPI, Firebase, REST APIs\n\nPROJECTS: QuickNotes, Skidder Ride Share, Clara SaaS Invoicing\n\nEXPERIENCE: Walmart, Roadie`;

export const MOCK_COVER_LETTER = (role: string) =>
  `Dear Hiring Manager,\n\nI am a Software Engineering student at Example State University applying for the ${role} role. My experience building QuickNotes, Skidder, and Clara aligns with your stack.\n\nSincerely,\nAda Lovelace`;
