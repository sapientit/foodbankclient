import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  formatLondonDate,
  formatLondonDateTime,
  formatSessionDate,
  formatTimeRange,
} from './london-time';

describe('addCalendarDays', () => {
  it('adds and subtracts whole days', () => {
    expect(addCalendarDays('2026-08-17', 6)).toBe('2026-08-23');
    expect(addCalendarDays('2026-08-17', -14)).toBe('2026-08-03');
    expect(addCalendarDays('2026-08-17', 0)).toBe('2026-08-17');
  });

  it('rolls over a month end, a year end and a leap day', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('does not move a day when the clocks do', () => {
    // BST begins on 29 March 2026 and ends on 25 October. Both ends are pinned
    // to UTC midnight, where a day is always twenty-four hours, so neither
    // changeover can knock a date onto its neighbour.
    expect(addCalendarDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addCalendarDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('returns what it was given when that will not parse', () => {
    expect(addCalendarDays('not a date', 1)).toBe('not a date');
    expect(addCalendarDays('2026-02-30', 1)).toBe('2026-02-30');
  });
});

describe('formatLondonDateTime', () => {
  it('shows the London wall clock, not UTC, in summer', () => {
    // The failure this exists to catch is silent: an hour out for half the year,
    // on a screen nobody cross-checks against a clock.
    expect(formatLondonDateTime('2026-07-06T13:05:00.000Z')).toBe('6 Jul 2026, 14:05');
  });

  it('shows the London wall clock across the BST changeover', () => {
    expect(formatLondonDateTime('2026-01-06T13:05:00.000Z')).toBe('6 Jan 2026, 13:05');
  });

  it('uses a 24-hour clock', () => {
    expect(formatLondonDateTime('2026-01-06T19:30:00.000Z')).toBe('6 Jan 2026, 19:30');
  });

  it('shows midnight as 00:00 rather than 24:00', () => {
    expect(formatLondonDateTime('2026-01-06T00:00:00.000Z')).toBe('6 Jan 2026, 00:00');
  });
});

describe('formatLondonDate', () => {
  it('formats an instant as a London date', () => {
    expect(formatLondonDate('2026-07-06T13:05:00.000Z')).toBe('6 Jul 2026');
  });

  it('uses the London day, so an instant late in the UTC evening is not the day before', () => {
    // 23:30 UTC in July is 00:30 the next day in London.
    expect(formatLondonDate('2026-07-06T23:30:00.000Z')).toBe('7 Jul 2026');
  });

  it('returns what it was given rather than the words Invalid Date', () => {
    expect(formatLondonDate('not a timestamp')).toBe('not a timestamp');
  });
});

describe('formatSessionDate', () => {
  it('keeps the day the charity typed, in summer and in winter', () => {
    expect(formatSessionDate('2026-08-04')).toBe('Tue, 4 Aug 2026');
    expect(formatSessionDate('2026-01-04')).toBe('Sun, 4 Jan 2026');
  });

  it('never moves a session to the day before', () => {
    /*
     * The failure this exists to stop: `new Date('2026-08-04')` is midnight UTC,
     * so formatting it anywhere west of Greenwich shows the third. A referrer
     * turning up a day early is the visible half; the invisible half is that it
     * is correct on every developer's machine in London.
     */
    expect(formatSessionDate('2026-08-04')).toContain('4 Aug 2026');
    expect(formatSessionDate('2026-01-01')).toContain('1 Jan 2026');
  });

  it('returns what it was given rather than the words Invalid Date', () => {
    expect(formatSessionDate('4 August')).toBe('4 August');
    expect(formatSessionDate('')).toBe('');
  });

  it('shows an impossible date as it arrived rather than silently shifting it', () => {
    // `Date.UTC` rolls over: the 31st of February would otherwise appear as the
    // 3rd of March, which is a wrong day nobody would question.
    expect(formatSessionDate('2026-02-31')).toBe('2026-02-31');
    expect(formatSessionDate('2026-99-99')).toBe('2026-99-99');
  });
});

describe('formatTimeRange', () => {
  it('shows a plain range within one day', () => {
    expect(formatTimeRange('10:00', 90)).toBe('10:00–11:30');
  });

  it('wraps past midnight rather than showing a time past 23:59', () => {
    // The reason this function takes no date at all: a delivery run starting
    // at 23:00 for two hours ends at 01:00, on whatever the next day turns out
    // to be, and this is deliberately silent about which day that is.
    expect(formatTimeRange('23:00', 120)).toBe('23:00–01:00');
  });

  it('leaves startTime exactly as it arrived across the BST changeover', () => {
    // No `Date` is ever constructed here, so the clocks changing has nothing to
    // act on — this is minutes-of-day arithmetic, not a timezone conversion.
    // Both the last Sunday of March and the last Sunday of October are BST
    // boundaries in Europe/London, and neither moves this by a minute.
    expect(formatTimeRange('10:00', 60)).toBe('10:00–11:00');
  });

  it('returns startTime alone when it will not parse', () => {
    expect(formatTimeRange('not a time', 30)).toBe('not a time');
  });

  it('handles a duration long enough to wrap more than once', () => {
    expect(formatTimeRange('06:00', 25 * 60)).toBe('06:00–07:00');
  });
});
