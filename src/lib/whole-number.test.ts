import { describe, expect, it } from 'vitest';
import { parseWholeNumber } from './whole-number';

describe('parseWholeNumber', () => {
  const bounds = { minimum: 0, maximum: 1000 };

  it('distinguishes an empty optional field from malformed text', () => {
    expect(parseWholeNumber('', bounds)).toEqual({ ok: false, problem: 'empty' });
    expect(parseWholeNumber('-', bounds)).toEqual({ ok: false, problem: 'not-a-whole-number' });
  });

  it('accepts a non-negative whole number within the supplied bounds', () => {
    expect(parseWholeNumber(' 0 ', bounds)).toEqual({ ok: true, value: 0 });
    expect(parseWholeNumber('1001', bounds)).toEqual({ ok: false, problem: 'above-maximum' });
  });
});
