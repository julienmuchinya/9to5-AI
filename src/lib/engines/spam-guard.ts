export interface SpamCheckInput {
  applicationsToday: number;
  lastApplicationAt?: Date;
  contactEmail: string;
  lastContactedAt?: Date;
  outreachBodyHash?: string;
  previousOutreachHashes: string[];
  followupCount: number;
  minDelayMinutes?: number;
}

export function canApplyNow(input: SpamCheckInput): {
  allowed: boolean;
  reasonCode?: string;
} {
  const minDelay = input.minDelayMinutes ?? 15;
  if (input.lastApplicationAt) {
    const elapsed =
      (Date.now() - input.lastApplicationAt.getTime()) / (1000 * 60);
    if (elapsed < minDelay) {
      return { allowed: false, reasonCode: "SPAM_GUARD_APPLY_TOO_FAST" };
    }
  }
  return { allowed: true };
}

export function canContactNow(input: SpamCheckInput): {
  allowed: boolean;
  reasonCode?: string;
} {
  if (input.lastContactedAt) {
    const daysSince =
      (Date.now() - input.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 5) {
      return { allowed: false, reasonCode: "SPAM_GUARD_CONTACT_COOLDOWN" };
    }
  }
  if (
    input.outreachBodyHash &&
    input.previousOutreachHashes.includes(input.outreachBodyHash)
  ) {
    return { allowed: false, reasonCode: "SPAM_GUARD_DUPLICATE_MESSAGE" };
  }
  if (input.followupCount >= 2) {
    return { allowed: false, reasonCode: "SPAM_GUARD_MAX_FOLLOWUPS" };
  }
  return { allowed: true };
}
