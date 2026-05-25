export const APP_NAME = "9to5 AI";

/** v1: passwords are never stored; use password manager reference only */
export const PASSWORD_STORAGE_ENABLED = false;
export const APP_TAGLINE =
  "Cloud job application agent — runs on schedule even when your dashboard is closed.";

export const FIT_AUTO_APPLY_MIN = 90;
export const FIT_REVIEW_MIN = 75;
export const TRUST_BLOCK_MAX = 80;
export const RESUME_REUSE_MIN = 95;
export const RESUME_KEYWORD_MIN = 90;
export const RESUME_TAILOR_MIN = 75;
export const COVER_LETTER_REUSE_MIN = 90;

export const DEFAULT_USAGE_LIMITS = {
  maxApplicationsPerDay: 50,
  maxOutreachPerDay: 10,
  maxFollowupsPerDay: 10,
  maxJobsAnalyzedPerDay: 90,
  maxCompaniesScannedPerDay: 80,
  maxAiCallsPerDay: 50,
  maxDbWritesPerDay: 1000,
  maxDbReadsPerDay: 5000,
  maxStorageMb: 400,
  maxCostPerDay: 0,
  maxCostPerMonth: 0,
};

export const KNOWN_ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "icims.com",
  "smartrecruiters.com",
  "ashbyhq.com",
  "jobs.lever.co",
  "boards.greenhouse.io",
];

export const SCAM_KEYWORDS = [
  { pattern: /ssn|social security/i, code: "SSN_REQUESTED", weight: 100 },
  { pattern: /bank account|routing number|wire transfer/i, code: "BANK_INFO", weight: 100 },
  { pattern: /send \$|pay \$|upfront fee|purchase equipment/i, code: "PAYMENT_REQUIRED", weight: 100 },
  { pattern: /crypto|bitcoin|mlm/i, code: "SCAM_SIGNAL", weight: 80 },
];

export const RESUME_TEMPLATE_SEEDS = [
  { name: "Software Engineering Intern", slug: "swe-intern", active: true },
  { name: "Backend Developer", slug: "backend", active: true },
  { name: "Frontend Developer", slug: "frontend", active: true },
  { name: "Full Stack Developer", slug: "fullstack", active: true },
  { name: "Cloud / DevOps", slug: "cloud-devops", active: true },
  { name: "Data Analyst", slug: "data-analyst", active: false },
  { name: "AI / ML", slug: "ai-ml", active: false },
  { name: "IT / Cloud Support", slug: "it-support", active: false },
  { name: "Technical Consultant", slug: "tech-consultant", active: false },
  { name: "Application Consultant", slug: "app-consultant", active: false },
  { name: "Business Technology Consultant", slug: "biz-tech-consultant", active: false },
  { name: "Junior Developer", slug: "junior-dev", active: false },
  { name: "Network / Systems", slug: "network-systems", active: false },
  { name: "DevOps Intern", slug: "devops-intern", active: false },
  { name: "Software Developer Intern", slug: "sw-dev-intern", active: false },
];

export const COVER_LETTER_TEMPLATE_SEEDS = [
  { name: "Software Engineering", slug: "swe" },
  { name: "Backend Development", slug: "backend" },
  { name: "Frontend Development", slug: "frontend" },
  { name: "Cloud / DevOps", slug: "cloud-devops" },
  { name: "Data Analyst", slug: "data-analyst" },
  { name: "AI / ML", slug: "ai-ml" },
  { name: "IT / Cloud Support", slug: "it-support" },
  { name: "Network / Systems", slug: "network-systems" },
  { name: "Technical Consultant", slug: "tech-consultant" },
];
