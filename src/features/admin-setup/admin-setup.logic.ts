import type { AdminReferralReason, AuthorisedReferrer } from './queries';

/**
 * The pure half of admin setup: the referrer domain round trip, the sort
 * orders, and the duplicate pre-checks the create screens use to name an
 * existing row rather than making the admin submit to find out.
 *
 * No React, no fetching, tested directly.
 */

/** `AuthorisedReferrer.organisationName`: `maxLength: 200`. */
export const MAX_ORGANISATION_NAME_LENGTH = 200;

/** `ReferralReason.code`: `pattern: '^[a-z0-9_]+$', maxLength: 60`. */
export const REASON_CODE_PATTERN = /^[a-z0-9_]+$/;
export const MAX_REASON_CODE_LENGTH = 60;

/** `ReferralReason.label`: `maxLength: 200`. */
export const MAX_REASON_LABEL_LENGTH = 200;

/**
 * What the admin types for a domain entry, turned into what the server
 * stores. `openapi.yaml`: "`matchType: domain` accepts `*@example.org`,
 * `@example.org` or `example.org` — all stored as the bare domain." Strips
 * at most one leading `*@` or `@`, in that order, so `*@` is never left
 * half-stripped as a literal `@`.
 *
 * Only meaningful for `matchType: 'domain'` — an email address is sent
 * exactly as typed, trimmed, because the server's own description says
 * nothing about stripping an email.
 */
export function normaliseDomainInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('*@')) return trimmed.slice(2);
  if (trimmed.startsWith('@')) return trimmed.slice(1);
  return trimmed;
}

/**
 * The other direction of the same round trip: a bare domain as stored,
 * turned into what a UI shows. Un-tested code here is exactly how "round
 * trip looks like it silently edited the row" happens — see
 * `admin-setup.logic.test.ts`, which asserts both directions against the
 * same fixture.
 */
export function displayMatchValue(referrer: {
  readonly matchType: AuthorisedReferrer['matchType'];
  readonly matchValue: string;
}): string {
  return referrer.matchType === 'domain' ? `*@${referrer.matchValue}` : referrer.matchValue;
}

/**
 * Maintenance order for the referrer list: organisation, then match value as
 * the tiebreak. The endpoint makes no ordering promise — the same reasoning
 * as `sortModelParcels`.
 */
export function sortAuthorisedReferrers(rows: readonly AuthorisedReferrer[]): AuthorisedReferrer[] {
  return [...rows].sort(
    (a, b) =>
      a.organisationName.localeCompare(b.organisationName) ||
      a.matchValue.localeCompare(b.matchValue),
  );
}

/**
 * The part of an email address after the `@`, lower-cased for comparison
 * against a stored domain. `null` for anything with no `@` at all, which a
 * `matchType: email` row's `matchValue` should never be, but this reads
 * untrusted-ish data (another admin's row) rather than something this
 * screen just validated.
 */
function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * The one case `openapi.yaml` calls out by name: "An exact-address entry
 * beats a domain entry, so deactivating one address blocks that person
 * while their colleagues carry on referring." An inactive email row is not
 * dead data sitting next to an unrelated domain row — it is *actively
 * doing something* precisely when an active domain row would otherwise let
 * that address through, and a list that cannot say so reads as two
 * unrelated rows instead of one blocking the other.
 *
 * Returns the blocked domain when this row is exactly that case, so the
 * screen can name it in the row rather than making an admin cross-reference
 * the table by eye. `null` for every other row, including an inactive email
 * with no matching active domain — which blocks nobody but that one address
 * regardless of any other row, so there is nothing to explain.
 */
export function blockedActiveDomain(
  rows: readonly AuthorisedReferrer[],
  row: AuthorisedReferrer,
): string | null {
  if (row.matchType !== 'email' || row.isActive) return null;

  const domain = emailDomain(row.matchValue);
  if (domain === null) return null;

  const domainIsActive = rows.some(
    (other) =>
      other.matchType === 'domain' && other.isActive && other.matchValue.toLowerCase() === domain,
  );

  return domainIsActive ? domain : null;
}

/**
 * The duplicate pre-check for the authorise screen. Matches on the
 * **normalised** value so `*@guildford.gov.uk` and `guildford.gov.uk` are
 * recognised as the same row before either reaches the server — deliberately
 * over every row, including inactive ones: "Never filter these out" applies
 * here too, since reactivating a deactivated entry is the fix, not creating
 * a second row that collides with it.
 */
export function findAuthorisedReferrer(
  rows: readonly AuthorisedReferrer[],
  matchType: AuthorisedReferrer['matchType'],
  rawValue: string,
): AuthorisedReferrer | undefined {
  const wanted = matchType === 'domain' ? normaliseDomainInput(rawValue) : rawValue.trim();
  if (wanted === '') return undefined;

  return rows.find((row) => row.matchType === matchType && row.matchValue.trim() === wanted);
}

/**
 * Maintenance order for the reasons list: `displayOrder`, then label as the
 * tiebreak — the same shape as `sortModelParcels`. This is the admin list;
 * the public endpoint applies its own ordering server-side and is not
 * touched by this function.
 */
export function sortReferralReasons(rows: readonly AdminReferralReason[]): AdminReferralReason[] {
  return [...rows].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label),
  );
}

/**
 * The duplicate pre-check for the add-a-reason screen. `code` is compared
 * exactly, not case-folded: the pattern (`^[a-z0-9_]+$`) already forbids
 * anything a fold would change, so folding here would only hide a
 * would-be-invalid character from the field validation instead of the
 * duplicate check that is actually running. Checked against every row,
 * including retired ones — a retired reason still holds its code and the
 * server still refuses a repeat of it.
 */
export function findReferralReasonByCode(
  rows: readonly AdminReferralReason[],
  code: string,
): AdminReferralReason | undefined {
  const wanted = code.trim();
  if (wanted === '') return undefined;

  return rows.find((row) => row.code === wanted);
}

export type DisplayOrderResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: 'empty' | 'not-a-whole-number' };

/**
 * `AdminReferralReason.displayOrder`: `type: integer`, no declared bounds.
 * Held and parsed as text rather than read off an `<input type="number">`
 * directly — the same reasoning as `parseWholeNumber` in the model-parcels
 * feature: the input cannot tell an empty box from a lone minus sign, and
 * this field is one of the few in the app that is legitimately allowed to
 * be negative (a reason meant to sort before everything else).
 */
export function parseDisplayOrder(text: string): DisplayOrderResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^-?\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'not-a-whole-number' };

  return { ok: true, value };
}
