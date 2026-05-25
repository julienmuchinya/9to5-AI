export type AgentDecision =
  | "AUTO_APPLY"
  | "AUTO_APPLY_READY"
  | "REVIEW"
  | "REVIEW_ONLY"
  | "SKIP"
  | "BLOCKED"
  | "EMERGENCY_STOP";

/** Part 3 job intake decision (no submission in Part 3) */
export type JobIntakeDecision =
  | "AUTO_APPLY_READY"
  | "REVIEW_ONLY"
  | "SKIP"
  | "BLOCKED";

export type JobStatus =
  | "discovered"
  | "analyzed"
  | "review"
  | "submitted"
  | "interview"
  | "rejected"
  | "offer"
  | "withdrawn"
  | "skipped";

export type ApplicationStatus =
  | "pending"
  | "pending_review"
  | "approved"
  | "submitted"
  | "blocked"
  | "skipped";

export interface JobInput {
  title: string;
  description: string;
  url?: string;
  companyName: string;
  companyDomain?: string;
  source?: string;
}

export interface FitResult {
  score: number;
  requiredSkillsMatched: string[];
  requiredSkillsMissing: string[];
  breakdown: {
    requiredSkills: number;
    responsibilities: number;
    preferredSkills: number;
    atsKeywords: number;
  };
}

export interface TrustResult {
  score: number;
  signals: string[];
}

export interface ScamResult {
  passed: boolean;
  score: number;
  signals: { code: string; weight: number; message: string }[];
}

export interface ResumeMatchResult {
  templateId: string;
  templateName: string;
  score: number;
  editTier: "none" | "keywords" | "tailor" | "generated";
}

export interface CoverLetterMatchResult {
  templateId: string;
  templateName: string;
  score: number;
}

export interface DecisionInput {
  fitScore: number;
  trustScore: number;
  scamPassed: boolean;
  resumeMatchScore: number;
  coverLetterMatchScore: number;
  emergencyStop: boolean;
  autoApplyEnabled: boolean;
  setupComplete: boolean;
  duplicateJob: boolean;
  duplicateApplication: boolean;
  truthFilterPassed: boolean;
  costRisk: boolean;
  captchaDetected: boolean;
  requiresLying: boolean;
  /** Job asks sponsorship/relocation question not answered in profile or best answers */
  sponsorshipQuestionUnanswered: boolean;
}

export interface DecisionOutput {
  decision: AgentDecision;
  reason: string;
  reasonCode: string;
}

export interface EvidenceItem {
  id?: string;
  category: string;
  title: string;
  content: string;
  skills?: string[];
  tools?: string[];
  proof?: string;
  approved?: boolean;
}

export interface SetupCheckItem {
  id: string;
  label: string;
  complete: boolean;
  fixSteps: string;
  href?: string;
}

export interface BudgetCounters {
  applications: number;
  outreach: number;
  followups: number;
  jobsAnalyzed: number;
  companiesScanned: number;
  aiCalls: number;
  dbWrites: number;
  dbReads: number;
}

export interface UsageLimits {
  maxApplicationsPerDay: number;
  maxOutreachPerDay: number;
  maxFollowupsPerDay: number;
  maxJobsAnalyzedPerDay: number;
  maxCompaniesScannedPerDay: number;
  maxAiCallsPerDay: number;
  maxDbWritesPerDay: number;
  maxDbReadsPerDay: number;
  maxCostPerDay: number;
}
