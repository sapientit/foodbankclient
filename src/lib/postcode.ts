/**
 * UK postcodes, normalised to one written form.
 *
 * `Referral questions.csv` asks for the client's postcode "in capitals AAn nAA
 * or AAnn nAA", the two shapes Guildford's own postcodes take. It is stored and
 * **searched on**, which is the whole reason it is normalised rather than kept
 * as typed: `gu234xx`, `GU23 4XX` and `Gu23  4xx` are one postcode, and three
 * spellings of it in the database are three households that do not match each
 * other.
 *
 * The pattern accepts every valid UK form, not only the two the CSV names — a
 * referral is for whoever turns up, and a household that moved from `W1A 1AA`
 * or lives at `E1 6AN` is not a typing mistake. Both named shapes are covered
 * by it, and everything formats identically: outward code, one space, inward
 * code, all capitals.
 *
 * No React, no fetching, tested directly.
 */

/**
 * Outward code (area, district) then inward code (sector, unit). Covers the six
 * outward forms — `A9`, `A99`, `A9A`, `AA9`, `AA99`, `AA9A` — against an inward
 * code that is always a digit and two letters.
 *
 * Deliberately not the full BS 7666 pattern with its excluded letters: this
 * catches somebody typing an address into the wrong box, which is what a form
 * field can usefully catch. Whether a well-formed postcode is a *real* one is a
 * lookup, and there is no postcode service here to ask.
 */
const POSTCODE_PATTERN = /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/;

/**
 * The postcode as it should be written and stored, or `null` if the text is not
 * one at all.
 *
 * Whitespace anywhere is ignored on the way in — people type `GU234XX` and
 * `GU23  4XX` about as often as the correct thing — and the single separating
 * space is put back in the one place it belongs: before the final three
 * characters, which are the inward code in every UK postcode regardless of how
 * long the outward code is.
 */
export function formatPostcode(text: string): string | null {
  const compact = text.replace(/\s+/g, '').toUpperCase();
  if (compact.length < 5 || compact.length > 7) return null;

  const outward = compact.slice(0, -3);
  const inward = compact.slice(-3);
  const formatted = `${outward} ${inward}`;

  return POSTCODE_PATTERN.test(formatted) ? formatted : null;
}

/** Whether `text` is a postcode at all, however it happens to be spaced or cased. */
export function isPostcode(text: string): boolean {
  return formatPostcode(text) !== null;
}
