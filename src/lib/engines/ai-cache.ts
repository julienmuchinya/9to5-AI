import { hashJobDescription } from "../utils/hash";

export interface CacheEntry {
  jdHash: string;
  fitScore?: number;
  output: Record<string, unknown>;
  selectedResumeTemplateId?: string;
  selectedCoverLetterTemplateId?: string;
  promptVersionId?: string;
  createdAt: string;
}

export function getJdHash(description: string): string {
  return hashJobDescription(description);
}

export function findCacheHit(
  description: string,
  cache: CacheEntry[]
): CacheEntry | null {
  const hash = getJdHash(description);
  return cache.find((c) => c.jdHash === hash) ?? null;
}

export function isSimilarDescription(a: string, b: string): boolean {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && overlap / union >= 0.85;
}
