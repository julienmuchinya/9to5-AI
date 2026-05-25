const SPONSORSHIP_PATTERNS = [
  /sponsorship/i,
  /visa\s+sponsor/i,
  /work\s+authorization/i,
  /authorized\s+to\s+work/i,
  /require.*sponsorship/i,
  /legally\s+authorized/i,
];

export function jobMentionsSponsorship(description: string): boolean {
  return SPONSORSHIP_PATTERNS.some((p) => p.test(description));
}

export function hasSavedSponsorshipAnswer(
  profileSponsorshipNeeded: boolean | undefined,
  bestAnswers: { question_pattern: string; answer: string }[]
): boolean {
  if (profileSponsorshipNeeded !== undefined) return true;
  return bestAnswers.some(
    (a) =>
      /sponsor|visa|work authorization/i.test(a.question_pattern) &&
      a.answer.trim().length > 0
  );
}

export function isSponsorshipQuestionUnanswered(
  description: string,
  profileSponsorshipNeeded: boolean | undefined,
  bestAnswers: { question_pattern: string; answer: string }[]
): boolean {
  if (!jobMentionsSponsorship(description)) return false;
  return !hasSavedSponsorshipAnswer(profileSponsorshipNeeded, bestAnswers);
}
