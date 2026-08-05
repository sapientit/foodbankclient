import { describe, expect, it } from 'vitest';
import { formatPostcode, isPostcode } from './postcode';

describe('formatPostcode', () => {
  it('formats the two shapes the referral form names', () => {
    // `Referral questions.csv`: "Format in capitals AAn nAA or AAnn nAA".
    expect(formatPostcode('gu2 4xx')).toBe('GU2 4XX');
    expect(formatPostcode('gu23 4xx')).toBe('GU23 4XX');
  });

  it('puts the space back when it was left out', () => {
    // The failure this exists to catch is silent: two spellings of one
    // household's postcode, neither of which finds the other in a search.
    expect(formatPostcode('GU234XX')).toBe('GU23 4XX');
  });

  it('collapses whatever spacing was typed', () => {
    expect(formatPostcode('  gu23   4xx ')).toBe('GU23 4XX');
  });

  it('accepts every valid outward form, not only the local ones', () => {
    expect(formatPostcode('e16an')).toBe('E1 6AN');
    expect(formatPostcode('m609ah')).toBe('M60 9AH');
    expect(formatPostcode('w1a1aa')).toBe('W1A 1AA');
    expect(formatPostcode('cr26xh')).toBe('CR2 6XH');
    expect(formatPostcode('dn551pt')).toBe('DN55 1PT');
    expect(formatPostcode('ec1a1bb')).toBe('EC1A 1BB');
  });

  it('rejects text that is not a postcode', () => {
    expect(formatPostcode('')).toBeNull();
    expect(formatPostcode('Guildford')).toBeNull();
    expect(formatPostcode('12 High Street')).toBeNull();
  });

  it('rejects a postcode that is the wrong length either way', () => {
    expect(formatPostcode('GU2 4X')).toBeNull();
    expect(formatPostcode('GU234 4XX')).toBeNull();
  });

  it('rejects an inward code that is not a digit and two letters', () => {
    expect(formatPostcode('GU23 44X')).toBeNull();
    expect(formatPostcode('GU23 XXX')).toBeNull();
  });

  it('rejects an outward code that does not start with a letter', () => {
    expect(formatPostcode('123 4XX')).toBeNull();
  });
});

describe('isPostcode', () => {
  it('is true however the postcode happens to be spaced or cased', () => {
    expect(isPostcode('gu234xx')).toBe(true);
    expect(isPostcode('GU23 4XX')).toBe(true);
  });

  it('is false for anything that will not format', () => {
    expect(isPostcode('not a postcode')).toBe(false);
  });
});
