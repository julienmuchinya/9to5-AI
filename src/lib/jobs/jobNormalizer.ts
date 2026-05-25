import { hashJobDescription } from "@/lib/utils/hash";

export type RemoteType = "remote" | "hybrid" | "on-site" | "unknown";

export interface RawJobInput {
  title: string;
  companyName: string;
  url?: string;
  location?: string;
  remoteType?: RemoteType;
  source: string;
  description: string;
  shortDescription?: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  keywords?: string[];
  dateFound?: string;
  rawEmailRef?: string;
  department?: string;
}

export interface NormalizedJob extends RawJobInput {
  normalizedTitle: string;
  normalizedCompany: string;
  normalizedLocation: string;
  normalizedSource: string;
  normalizedUrl: string;
  descriptionHash: string;
}

const TITLE_ALIASES: Record<string, string> = {
  "software engineer intern": "Software Engineer Intern",
  "software developer intern": "Software Engineer Intern",
  "swe intern": "Software Engineer Intern",
  "full stack intern": "Full Stack Intern",
  "fullstack intern": "Full Stack Intern",
  "backend intern": "Backend Intern",
  "cloud intern": "Cloud Engineer Intern",
  "cloud engineer intern": "Cloud Engineer Intern",
  "devops intern": "DevOps Intern",
  "data analyst intern": "Data Analyst Intern",
  "ai/ml intern": "AI/ML Intern",
  "ai ml intern": "AI/ML Intern",
  "machine learning intern": "AI/ML Intern",
  "it support": "IT Support",
  "cloud support": "Cloud Support",
  "technical consultant intern": "Technical Consultant Intern",
};

function normalizeTitle(title: string): string {
  const key = title.toLowerCase().replace(/[^a-z0-9/+\s-]/g, "").trim();
  return TITLE_ALIASES[key] ?? title.trim().replace(/\s+/g, " ");
}

function normalizeCompany(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeLocation(loc?: string): string {
  if (!loc) return "Unknown";
  return loc.trim().replace(/\s+/g, " ");
}

function normalizeUrl(url?: string): string {
  if (!url) return "";
  return url.toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "").trim();
}

function extractSkills(text: string, label: "required" | "preferred"): string[] {
  const pattern =
    label === "required"
      ? /required[:\s]+([^\n]+)/i
      : /preferred[:\s]+([^\n]+)/i;
  const match = text.match(pattern);
  if (!match) return [];
  return match[1]
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 40);
}

function extractKeywords(text: string): string[] {
  const tech = [
    "python", "java", "react", "node", "sql", "aws", "docker", "kubernetes",
    "typescript", "go", "rust", "postgresql", "firebase", "flask", "fastapi",
  ];
  const lower = text.toLowerCase();
  return tech.filter((t) => lower.includes(t));
}

export function normalizeJob(raw: RawJobInput): NormalizedJob {
  const requiredSkills = raw.requiredSkills ?? extractSkills(raw.description, "required");
  const preferredSkills = raw.preferredSkills ?? extractSkills(raw.description, "preferred");
  const keywords = raw.keywords ?? extractKeywords(raw.description);

  return {
    ...raw,
    normalizedTitle: normalizeTitle(raw.title),
    normalizedCompany: normalizeCompany(raw.companyName),
    normalizedLocation: normalizeLocation(raw.location),
    normalizedSource: raw.source.toLowerCase().trim(),
    normalizedUrl: normalizeUrl(raw.url),
    descriptionHash: hashJobDescription(raw.description),
    requiredSkills,
    preferredSkills,
    keywords,
    dateFound: raw.dateFound ?? new Date().toISOString(),
  };
}
