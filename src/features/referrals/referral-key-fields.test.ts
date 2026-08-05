import { describe, expect, it } from 'vitest';
import type { KeyFieldName } from './referral-form-definition';
import { keyFieldSchema, keyFieldValue } from './referral-key-fields';

function accepts(field: KeyFieldName, value: string, required = true): boolean {
  return keyFieldSchema(field, { label: field, required }).safeParse(value).success;
}

describe('keyFieldSchema', () => {
  it('requires a required field and lets an optional one be blank', () => {
    expect(accepts('refereeFirstName', '')).toBe(false);
    expect(accepts('refereePhone', '', false)).toBe(true);
  });

  it('checks an email address loosely, the way the referrer check does', () => {
    expect(accepts('referrerEmail', 'jane@guildford.gov.uk')).toBe(true);
    expect(accepts('referrerEmail', 'jane at guildford')).toBe(false);
  });

  it('checks a phone number by length, matching the server bounds', () => {
    expect(accepts('referrerPhone', '01483 123456')).toBe(true);
    expect(accepts('referrerPhone', '123')).toBe(false);
  });

  it('accepts a postcode however it was spaced or cased', () => {
    expect(accepts('refereePostcode', 'gu234xx')).toBe(true);
    expect(accepts('refereePostcode', 'Guildford')).toBe(false);
  });

  it('rejects a date of birth that is not a real date', () => {
    expect(accepts('refereeDateOfBirth', '1975-08-04')).toBe(true);
    expect(accepts('refereeDateOfBirth', '1975-02-31')).toBe(false);
    expect(accepts('refereeDateOfBirth', '4 August 1975')).toBe(false);
  });

  it('rejects a date of birth in the future', () => {
    expect(accepts('refereeDateOfBirth', '2999-01-01')).toBe(false);
  });

  it('rejects a year that is almost certainly a typo', () => {
    // 1875 for 1975. Nothing downstream would question it and the referrer
    // would never see it again.
    expect(accepts('refereeDateOfBirth', '1875-08-04')).toBe(false);
  });

  it('keeps at least one adult on every referral, so it maps to a real grid cell', () => {
    expect(accepts('adults', '0')).toBe(false);
    expect(accepts('adults', '1')).toBe(true);
    expect(accepts('children', '0')).toBe(true);
  });

  it('rejects a household count that is not a whole number', () => {
    expect(accepts('adults', '2.5')).toBe(false);
    expect(accepts('adults', 'two')).toBe(false);
  });

  it('does not second-guess a lookup, whose list only the server has', () => {
    expect(accepts('sessionId', 'whatever-id-the-server-offered')).toBe(true);
    expect(accepts('reasonId', 'whatever-id-the-server-offered')).toBe(true);
  });
});

describe('keyFieldValue', () => {
  it('turns a ticked yes/no field into true and an unticked one into false', () => {
    expect(keyFieldValue('isDelivery', 'Yes')).toBe(true);
    expect(keyFieldValue('isDelivery', '')).toBe(false);
    expect(keyFieldValue('needsFuelHelp', '')).toBe(false);
  });

  it('turns a count into a number', () => {
    expect(keyFieldValue('adults', ' 3 ')).toBe(3);
  });

  it('turns a blank optional phone into null, so it is omitted rather than stored empty', () => {
    expect(keyFieldValue('refereePhone', '  ')).toBeNull();
    expect(keyFieldValue('referrerPhone', '')).toBeNull();
  });

  it('formats the postcode, the one field stored differently from how it was typed', () => {
    expect(keyFieldValue('refereePostcode', 'gu23  4xx')).toBe('GU23 4XX');
  });

  it('leaves an unformattable postcode as typed, for the server to refuse', () => {
    // Only reachable by a caller that skipped validation. A wrong-shaped
    // payload the server `400`s beats a crash in a referrer's browser.
    expect(keyFieldValue('refereePostcode', 'Guildford')).toBe('Guildford');
  });

  it('trims a name rather than storing the spaces somebody pasted', () => {
    expect(keyFieldValue('refereeSurname', '  Robinson ')).toBe('Robinson');
  });
});
