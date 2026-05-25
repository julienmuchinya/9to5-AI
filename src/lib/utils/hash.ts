import { createHash } from "crypto";

export function normalizeJobKey(
  companyName: string,
  jobTitle: string,
  url: string,
  source: string
): string {
  const canonicalUrl = url
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "")
    .trim();
  const raw = [
    companyName.toLowerCase().trim(),
    jobTitle.toLowerCase().trim(),
    canonicalUrl,
    source.toLowerCase().trim(),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

export function hashJobDescription(description: string): string {
  const normalized = description.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
