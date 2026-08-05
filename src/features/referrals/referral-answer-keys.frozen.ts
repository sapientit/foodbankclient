import type { FrozenAnswerKey } from './referral-form-guards';

/**
 * Every `answers` key the referral form has ever released, and what kind of
 * question it was.
 *
 * **Append only. Never edit a line, never delete one, never reuse a key.** A
 * referral captured last year comes back with the keys it was captured under,
 * so reusing one silently changes the meaning of old referrals and nothing
 * anywhere will fail when it happens. This file and `reusedKeys` /
 * `unrecordedKeys` are the only enforcement there is — the server holds no form
 * definition to compare against.
 *
 * **Adding a question means adding it here in the same change.**
 * `unrecordedKeys` is what notices if you forget.
 *
 * **Removing a question needs no change here.** Its key stays recorded, which
 * is the point: the ledger remembers what the key meant even after nothing asks
 * it any more.
 *
 * Key fields are not listed. They are typed columns rather than `answers`
 * entries, and the server owns their names.
 *
 * The keys are the `Key` column of `Referral questions.csv` verbatim, spaces,
 * capitals and slashes included, because that column is where Pete said how
 * each answer should appear in the JSON. They read oddly beside this codebase's
 * `camelCase` values and that is the right trade: these are data the charity
 * chose, frozen for the life of the system, not identifiers.
 */
export const FROZEN_ANSWER_KEYS: readonly FrozenAnswerKey[] = [
  // Version 1 — the questions replacing the charity's Google Form, 2026-08-05.
  { key: 'Collect', type: 'text' },
  { key: 'Child 0-2', type: 'number' },
  { key: 'Child 3-4', type: 'number' },
  { key: 'Child 5-11', type: 'number' },
  { key: 'Child 12-17', type: 'number' },
  { key: 'Cause Details', type: 'text' },
  { key: 'Secondary', type: 'choice' },
  { key: 'Dietary', type: 'text' },
  { key: 'Pasta/Rice', type: 'choice' },
  { key: 'Sugar/Flour', type: 'choice' },
  { key: 'Oil', type: 'choice' },
  { key: 'Tea/Coffee', type: 'choice' },
  { key: 'Eggs', type: 'choice' },
  { key: 'Porridge', type: 'choice' },
  { key: 'Pets', type: 'text' },
  { key: 'Spread', type: 'choice' },
  { key: 'Pulses', type: 'text' },
  { key: 'Sanitary', type: 'choice' },
  { key: 'Toiletries', type: 'choice' },
  { key: 'Nappies', type: 'choice' },
  { key: 'Baby Food', type: 'choice' },
  { key: 'Baby Milk', type: 'choice' },
  { key: 'Household', type: 'choice' },
  { key: 'Pre-Payment', type: 'choice' },
  { key: 'Contact approved', type: 'choice' },
  { key: 'Other', type: 'text' },
];
