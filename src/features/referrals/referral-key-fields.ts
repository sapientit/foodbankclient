import * as z from 'zod';
import { isCalendarDate, londonToday } from '../../lib/london-time';
import { formatPostcode } from '../../lib/postcode';
import type { KeyFieldName } from './referral-form-definition';
import {
  MAX_NAME_PART_LENGTH,
  MAX_REFEREE_ADDRESS_LENGTH,
  MAX_REFERRER_NAME_LENGTH,
  PHONE_BOUNDS,
  parseWholeNumber,
} from './referrals.logic';

export const ADULTS_BOUNDS = { minimum: 1, maximum: 30 };
export const CHILDREN_BOUNDS = { minimum: 0, maximum: 30 };

/**
 * The typed columns, and the rules the JSON config is deliberately not allowed
 * to express.
 *
 * `.claude/rules/referral-form.md`: "Fixed columns are separate and typed... Do
 * not fold them into `answers`." A date of birth, a postcode and a session id
 * are not things a form configuration should be inventing validation for — the
 * server has bounds for each of them and getting one wrong is a `400` a
 * referrer cannot act on. So `referral-form.config.json` says only *where* a
 * key field sits on the form and whether it is required; everything about what
 * a valid one looks like is here.
 *
 * That division is also what makes the config file small. Eleven kinds of
 * validation appear in `Referral questions.csv` — email, phone, date, postcode,
 * valid session, cause of crisis — and **every one of them is on a row marked
 * `Key field`**, so none of them needs a config vocabulary at all.
 *
 * No React, no fetching, tested directly.
 */

/** `ReferralSubmission.referrerOrganisation`: `maxLength: 200`. */
const MAX_ORGANISATION_LENGTH = 200;

/**
 * The oldest date of birth the form will take. Not a rule the charity has
 * given, and not a rule about people: it is here to catch `1875` typed for
 * `1975`, which a referrer would otherwise not notice and nothing downstream
 * would question.
 */
const EARLIEST_BIRTH_YEAR = 1900;

/**
 * A list fetched at runtime rather than declared. `sessions` and
 * `referralReasons` are the two public lookups the form needs;
 * `organisations` fills the dropdown beside the free-text box for an
 * organisation that is not on it.
 */
export type KeyFieldLookup = 'sessions' | 'referralReasons' | 'organisations';

/** The two lookups a plain dropdown draws on. `organisations` is not one of them — it always needs a way out, so it is `lookupOrOther`. */
export type ClosedLookup = Exclude<KeyFieldLookup, 'organisations'>;

/**
 * What a key field is rendered as. Coarser than an HTML input type on purpose —
 * `phone` and `email` differ in validation and keyboard, `count` and `yesNo`
 * differ in shape, and the form renderer only ever needs to switch on this.
 */
export type KeyFieldControl =
  | { readonly kind: 'text'; readonly maxLength: number }
  | { readonly kind: 'longText'; readonly maxLength: number }
  | { readonly kind: 'email' }
  | { readonly kind: 'phone' }
  | { readonly kind: 'date' }
  | { readonly kind: 'postcode' }
  | { readonly kind: 'count'; readonly minimum: number; readonly maximum: number }
  | { readonly kind: 'yesNo' }
  | { readonly kind: 'lookup'; readonly source: ClosedLookup }
  /**
   * A lookup with a way out. `Referral questions.csv` rows 4-5 ask for the
   * referrer's organisation twice — once as a list, once as free text, "either
   * this or the previous one" — because a Google Form cannot offer both in one
   * question. **Here it is one question and one column**, with the free-text box
   * revealed by choosing "My organisation is not listed". Two questions writing
   * one column would mean two ways for it to end up empty.
   */
  | {
      readonly kind: 'lookupOrOther';
      readonly source: 'organisations';
      readonly maxLength: number;
    };

/** What the submission body wants once the string a form field holds has been parsed back. */
export type KeyFieldValueKind = 'string' | 'nullableString' | 'integer' | 'boolean';

export interface KeyFieldSpec {
  readonly control: KeyFieldControl;
  readonly valueKind: KeyFieldValueKind;
}

/**
 * The value a `yesNo` field holds when it is ticked. A single-choice question
 * rather than a boolean input, so it reads the same as every other "Choose 0 or
 * 1 (yes)" row in the CSV.
 */
export const YES = 'Yes';

const KEY_FIELDS: Readonly<Record<KeyFieldName, KeyFieldSpec>> = {
  referrerName: {
    control: { kind: 'text', maxLength: MAX_REFERRER_NAME_LENGTH },
    valueKind: 'string',
  },
  referrerEmail: { control: { kind: 'email' }, valueKind: 'string' },
  referrerOrganisation: {
    control: { kind: 'lookupOrOther', source: 'organisations', maxLength: MAX_ORGANISATION_LENGTH },
    valueKind: 'string',
  },
  referrerPhone: { control: { kind: 'phone' }, valueKind: 'nullableString' },
  refereeFirstName: {
    control: { kind: 'text', maxLength: MAX_NAME_PART_LENGTH },
    valueKind: 'string',
  },
  refereeSurname: {
    control: { kind: 'text', maxLength: MAX_NAME_PART_LENGTH },
    valueKind: 'string',
  },
  refereeDateOfBirth: { control: { kind: 'date' }, valueKind: 'string' },
  refereeAddress: {
    control: { kind: 'longText', maxLength: MAX_REFEREE_ADDRESS_LENGTH },
    valueKind: 'string',
  },
  refereePostcode: { control: { kind: 'postcode' }, valueKind: 'string' },
  refereePhone: { control: { kind: 'phone' }, valueKind: 'nullableString' },
  sessionId: { control: { kind: 'lookup', source: 'sessions' }, valueKind: 'string' },
  isDelivery: { control: { kind: 'yesNo' }, valueKind: 'boolean' },
  adults: { control: { kind: 'count', ...ADULTS_BOUNDS }, valueKind: 'integer' },
  children: { control: { kind: 'count', ...CHILDREN_BOUNDS }, valueKind: 'integer' },
  reasonId: { control: { kind: 'lookup', source: 'referralReasons' }, valueKind: 'string' },
  needsFuelHelp: { control: { kind: 'yesNo' }, valueKind: 'boolean' },
};

export function keyFieldSpec(field: KeyFieldName): KeyFieldSpec {
  return KEY_FIELDS[field];
}

/**
 * Validation for one key field, as a `z.string()` like every other field this
 * form builds — React Hook Form hands back what the input holds regardless of
 * what the column eventually wants. `keyFieldValue` is the second half.
 */
export function keyFieldSchema(
  field: KeyFieldName,
  question: { readonly label: string; readonly required: boolean },
): z.ZodType<string> {
  const { control } = KEY_FIELDS[field];
  const { label, required } = question;

  return z.string().superRefine((value, ctx) => {
    const trimmed = value.trim();

    if (trimmed === '') {
      if (required) ctx.addIssue({ code: 'custom', message: `${label} is required.` });
      return;
    }

    const problem = describeProblem(control, trimmed, label);
    if (problem !== null) ctx.addIssue({ code: 'custom', message: problem });
  });
}

function describeProblem(control: KeyFieldControl, value: string, label: string): string | null {
  switch (control.kind) {
    case 'text':
    case 'longText':
    case 'lookupOrOther':
      return value.length > control.maxLength
        ? `${label}: use ${String(control.maxLength)} characters or fewer.`
        : null;

    case 'email':
      // Deliberately loose, and the same shape the referrer check already uses:
      // the server is the only thing that can say whether an address exists,
      // and a strict pattern here rejects real addresses to no benefit.
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? null
        : `${label}: enter a valid email address.`;

    case 'phone':
      return value.length < PHONE_BOUNDS.minLength || value.length > PHONE_BOUNDS.maxLength
        ? `${label}: enter a phone number between ${String(PHONE_BOUNDS.minLength)} and ${String(PHONE_BOUNDS.maxLength)} characters.`
        : null;

    case 'date':
      return describeDateProblem(value, label);

    case 'postcode':
      return formatPostcode(value) === null
        ? `${label}: enter a valid UK postcode, for example GU23 4XX.`
        : null;

    case 'count': {
      const parsed = parseWholeNumber(value, control);
      if (parsed.ok) return null;
      return parsed.problem === 'not-a-whole-number' || parsed.problem === 'empty'
        ? `${label}: enter a whole number.`
        : `${label}: enter a number between ${String(control.minimum)} and ${String(control.maximum)}.`;
    }

    case 'yesNo':
      return value === YES ? null : `${label}: that is not a valid answer.`;

    case 'lookup':
      // The list arrives at runtime, so "is this one of them?" is the
      // renderer's job — it can only offer what it was given. A stale id is
      // the server's `422`, whose message is written to be shown.
      return null;
  }
}

function describeDateProblem(value: string, label: string): string | null {
  if (!isCalendarDate(value)) return `${label}: enter a date as day, month and year.`;
  if (value > londonToday()) return `${label}: that date is in the future.`;
  if (Number(value.slice(0, 4)) < EARLIEST_BIRTH_YEAR) {
    return `${label}: check the year.`;
  }
  return null;
}

/**
 * The validated string, as the submission body wants it. `null` means **omit
 * this field** — an optional phone number left blank is absent, not `''`, which
 * the server would store forever as a real answer.
 *
 * Assumes `value` already passed `keyFieldSchema` — a bad number falls back to
 * the raw text rather than throwing, so a caller that skipped validation gets a
 * wrong-shaped payload the server will `400` rather than a client crash.
 */
export function keyFieldValue(
  field: KeyFieldName,
  value: string,
): string | number | boolean | null {
  const { control, valueKind } = KEY_FIELDS[field];
  const trimmed = value.trim();

  if (valueKind === 'boolean') return trimmed === YES;

  if (trimmed === '') return valueKind === 'nullableString' ? null : '';

  if (valueKind === 'integer') {
    const parsed = parseWholeNumber(trimmed, control.kind === 'count' ? control : ADULTS_BOUNDS);
    return parsed.ok ? parsed.value : trimmed;
  }

  // The one field stored in a different form from the one it was typed in.
  // `Referral questions.csv`: "Format in capitals AAn nAA or AAnn nAA", because
  // it is searched on and three spellings of one postcode match nothing.
  if (control.kind === 'postcode') return formatPostcode(trimmed) ?? trimmed;

  return trimmed;
}
