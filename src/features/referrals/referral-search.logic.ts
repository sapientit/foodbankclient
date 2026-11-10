import type { ReferralSearchRequest } from './queries';

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

/**
 * The server's floor for a surname start: 3 characters once leading whitespace
 * is gone. A trailing space counts, because `"Di "` is how an administrator
 * finds Di Lima without also finding Dibb.
 */
export const SURNAME_PREFIX_MIN_LENGTH = 3;

export type SurnamePrefixState = 'empty' | 'too-short' | 'usable';

export function surnamePrefixState(value: string): SurnamePrefixState {
  const length = value.trimStart().length;
  if (length === 0) return 'empty';
  return length < SURNAME_PREFIX_MIN_LENGTH ? 'too-short' : 'usable';
}

export interface ReferralSearchBoxes {
  readonly dateOfBirth: string;
  readonly postcode: string;
  readonly phone: string;
  readonly surnamePrefix: string;
}

/**
 * What the boxes send, or `null` when they cannot make a search. A surname
 * start searches on its own or narrows the other three; one too short to send
 * blocks the search rather than being quietly dropped, because dropping it
 * would widen a search the administrator meant to narrow. The surname is sent
 * untrimmed — its trailing space is part of the prefix.
 */
export function referralSearchInput(boxes: ReferralSearchBoxes): ReferralSearchRequest | null {
  const surname = surnamePrefixState(boxes.surnamePrefix);
  if (surname === 'too-short') return null;
  const input = {
    ...(boxes.dateOfBirth === '' ? {} : { dateOfBirth: boxes.dateOfBirth }),
    ...(boxes.postcode === '' ? {} : { postcode: boxes.postcode }),
    ...(boxes.phone === '' ? {} : { phone: boxes.phone }),
    ...(surname === 'usable' ? { surnamePrefix: boxes.surnamePrefix } : {}),
  };
  return Object.keys(input).length === 0 ? null : input;
}
