import { buildJobIdempotencyKey, buildUrlDedupeKey } from "./idempotency";
import type { NormalizedJob } from "./jobNormalizer";

export interface ExistingJobRecord {
  id: string;
  idempotency_key: string;
  url?: string;
  company_name: string;
  title: string;
  description_hash?: string;
  last_seen_at?: string;
}

export interface DedupeResult {
  isDuplicate: boolean;
  matchType?: "idempotency_key" | "url" | "company_title" | "description_hash";
  existingJobId?: string;
  idempotencyKey: string;
}

export function checkDuplicate(
  job: NormalizedJob,
  existing: ExistingJobRecord[]
): DedupeResult {
  const idempotencyKey = buildJobIdempotencyKey({
    companyName: job.normalizedCompany,
    title: job.normalizedTitle,
    url: job.normalizedUrl,
    source: job.normalizedSource,
  });

  const byKey = existing.find((e) => e.idempotency_key === idempotencyKey);
  if (byKey) {
    return {
      isDuplicate: true,
      matchType: "idempotency_key",
      existingJobId: byKey.id,
      idempotencyKey,
    };
  }

  if (job.normalizedUrl) {
    const urlKey = buildUrlDedupeKey(job.normalizedUrl);
    const byUrl = existing.find(
      (e) => e.url && buildUrlDedupeKey(e.url) === urlKey
    );
    if (byUrl) {
      return {
        isDuplicate: true,
        matchType: "url",
        existingJobId: byUrl.id,
        idempotencyKey,
      };
    }
  }

  const byTitle = existing.find(
    (e) =>
      e.company_name.toLowerCase() === job.normalizedCompany.toLowerCase() &&
      e.title.toLowerCase() === job.normalizedTitle.toLowerCase()
  );
  if (byTitle) {
    return {
      isDuplicate: true,
      matchType: "company_title",
      existingJobId: byTitle.id,
      idempotencyKey,
    };
  }

  const byHash = existing.find(
    (e) => e.description_hash && e.description_hash === job.descriptionHash
  );
  if (byHash) {
    return {
      isDuplicate: true,
      matchType: "description_hash",
      existingJobId: byHash.id,
      idempotencyKey,
    };
  }

  return { isDuplicate: false, idempotencyKey };
}

export function touchDuplicateJob<T extends ExistingJobRecord>(
  existing: T[],
  jobId: string
): T[] {
  const now = new Date().toISOString();
  return existing.map((j) =>
    j.id === jobId ? { ...j, last_seen_at: now } : j
  );
}
