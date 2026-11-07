/** Why an application is waiting on the user, grouped so the Needs-you list can be worked through by kind. */
export type NeedsKind = "questions" | "signin" | "manual" | "captcha" | "check" | "other";

export const NEEDS_LABEL: Record<NeedsKind, { label: string; hint: string }> = {
  questions: { label: "Answer questions", hint: "Answer once at the top of this page — the agent reapplies everywhere that question appears." },
  signin: { label: "Sign-in / verify email", hint: "Usually a Workday account email. The agent retries by itself; if it still fails, open the portal with the login on the card." },
  manual: { label: "Apply yourself", hint: "Sites the agent can't submit to (SmartRecruiters blocks automated browsers with a CAPTCHA; Oracle, Taleo…). The answers it prepared are on the card." },
  captcha: { label: "CAPTCHA", hint: "The site asked for a human check. The form is filled in — open it, finish the check and press Submit." },
  check: { label: "Check it went through", hint: "The agent submitted or got stuck on a step and couldn't confirm. Open it to make sure." },
  other: { label: "Other", hint: "" },
};

export function needsKind(error: string | null | undefined, pendingCount = 0): NeedsKind {
  const e = error ?? "";
  if (pendingCount > 0 || /waiting on your answer|needs your answer/i.test(e)) return "questions";
  if (/captcha/i.test(e)) return "captcha";
  if (/can only submit|needs an account|apply yourself/i.test(e)) return "manual";
  if (/sign[- ]?in|verify|verification|password|account|portal login/i.test(e)) return "signin";
  if (/no confirmation|form rejected|stopped at|unexpected page|couldn.t find|tried 3 times|security code/i.test(e)) return "check";
  return "other";
}
