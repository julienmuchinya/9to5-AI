export interface HumanLikeGuardState {
  lastCompanyScanAt?: number;
  lastEmailBatchAt?: number;
  companyScanCount: number;
  emailBatchCount: number;
}

export interface SlowdownDecision {
  shouldDelay: boolean;
  delayMs: number;
  reason: string;
}

const DEFAULT_COMPANY_DELAY_MS = 2000;
const DEFAULT_EMAIL_BATCH_DELAY_MS = 1500;
const MAX_COMPANY_SCANS_PER_HOUR = 40;

export function shouldDelayCompanyScan(
  state: HumanLikeGuardState,
  delayMs = DEFAULT_COMPANY_DELAY_MS
): SlowdownDecision {
  const now = Date.now();
  if (state.lastCompanyScanAt) {
    const elapsed = now - state.lastCompanyScanAt;
    if (elapsed < delayMs) {
      return {
        shouldDelay: true,
        delayMs: delayMs - elapsed,
        reason: "Delay between company scans (spam guard)",
      };
    }
  }
  if (state.companyScanCount >= MAX_COMPANY_SCANS_PER_HOUR) {
    return {
      shouldDelay: true,
      delayMs: 60000,
      reason: "Hourly company scan cap reached",
    };
  }
  return { shouldDelay: false, delayMs: 0, reason: "ok" };
}

export function shouldDelayEmailBatch(
  state: HumanLikeGuardState,
  delayMs = DEFAULT_EMAIL_BATCH_DELAY_MS
): SlowdownDecision {
  const now = Date.now();
  if (state.lastEmailBatchAt) {
    const elapsed = now - state.lastEmailBatchAt;
    if (elapsed < delayMs) {
      return {
        shouldDelay: true,
        delayMs: delayMs - elapsed,
        reason: "Delay between email batches (spam guard)",
      };
    }
  }
  return { shouldDelay: false, delayMs: 0, reason: "ok" };
}

export function recordCompanyScan(state: HumanLikeGuardState): HumanLikeGuardState {
  return {
    ...state,
    lastCompanyScanAt: Date.now(),
    companyScanCount: state.companyScanCount + 1,
  };
}

export function recordEmailBatch(state: HumanLikeGuardState): HumanLikeGuardState {
  return {
    ...state,
    lastEmailBatchAt: Date.now(),
    emailBatchCount: state.emailBatchCount + 1,
  };
}

export function assertNoOutreachOrApply(): { allowed: boolean; reason: string } {
  return {
    allowed: false,
    reason: "Part 3: outreach and auto-apply submission are disabled",
  };
}
