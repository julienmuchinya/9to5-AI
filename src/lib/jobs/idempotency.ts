import { normalizeJobKey, hashJobDescription } from "@/lib/utils/hash";

export function buildJobIdempotencyKey(input: {
  companyName: string;
  title: string;
  url?: string;
  source: string;
}): string {
  return normalizeJobKey(
    input.companyName,
    input.title,
    input.url ?? "",
    input.source
  );
}

export function buildDescriptionIdempotencyKey(description: string): string {
  return hashJobDescription(description);
}

export function buildUrlDedupeKey(url: string): string {
  return url
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "")
    .trim();
}
