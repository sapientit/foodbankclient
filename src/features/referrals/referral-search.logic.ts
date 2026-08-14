/**
 * These are dynamic-answer keys owned by the referral form configuration, not
 * server fields. The search endpoint deliberately returns the whole answers
 * map so the application that owns that configuration chooses what to show.
 */
export const REASON_ADDITIONAL_KEY = 'reasonAdditional';
export const SECONDARY_REASON_KEY = 'Secondary';

export function answerText(answers: Readonly<Record<string, unknown>>, key: string): string {
  const value = answers[key];
  return typeof value === 'string' && value !== '' ? value : '—';
}

export function answerChoiceId(
  answers: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = answers[key];
  if (!isUnknownArray(value) || value.length !== 1) return null;
  const choice = value[0];
  return typeof choice === 'string' && choice !== '' ? choice : null;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
