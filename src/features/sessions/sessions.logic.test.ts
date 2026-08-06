import { describe, expect, it } from 'vitest';
import type { RecurringSession, Session } from './queries';
import {
  SESSION_STATUS_LABELS,
  SESSION_STATUS_OPTIONS,
  WEEKDAY_LABELS,
  WEEKDAY_OPTIONS,
  describeLockedSession,
  describeMaterialisation,
  describeOccupancy,
  groupByDate,
  isLocalTime,
  isSessionStatus,
  isWeekday,
  occupancy,
  parseWholeNumber,
  sortRecurringSessions,
  sortSessions,
} from './sessions.logic';

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    sessionDate: '2026-08-04',
    startTime: '10:00',
    startsAtUtc: '2026-08-04T09:00:00.000Z',
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    deliveryTime: null,
    deliveriesAllowed: false,
    capacity: 25,
    booked: 10,
    status: 'planned',
    cancelledReason: null,
    isCustomised: false,
    recurringSessionId: null,
    occurrenceDate: null,
    ...overrides,
  };
}

function recurring(
  overrides: Partial<RecurringSession> & Pick<RecurringSession, 'id'>,
): RecurringSession {
  return {
    name: 'Tuesday session',
    weekday: 2,
    startTime: '10:00',
    durationMinutes: 90,
    location: 'St Mary’s Hall',
    deliveryTime: null,
    deliveriesAllowed: false,
    capacity: 25,
    activeFrom: '2026-01-01',
    activeUntil: null,
    ...overrides,
  };
}

describe('SESSION_STATUS_LABELS', () => {
  it('names every status the server can send', () => {
    for (const label of Object.values(SESSION_STATUS_LABELS)) {
      expect(label).not.toBe('');
    }
  });

  it('offers one option per status, derived from the labels', () => {
    expect(SESSION_STATUS_OPTIONS.map((option) => option.value).sort()).toEqual(
      Object.keys(SESSION_STATUS_LABELS).sort(),
    );
  });

  it('recognises only the statuses it can label', () => {
    expect(isSessionStatus('planned')).toBe(true);
    expect(isSessionStatus('cancelled')).toBe(true);
    expect(isSessionStatus('bogus')).toBe(false);
    expect(isSessionStatus(undefined)).toBe(false);
  });
});

describe('sortSessions', () => {
  it('orders on startsAtUtc, never on the wall clock', () => {
    // A 09:30 wall-clock session that starts later in UTC (across a timezone
    // trick) must still sort by the instant, not by the string "09:30" < "10:00".
    const later = session({ id: 'a', startTime: '09:30', startsAtUtc: '2026-08-04T10:00:00.000Z' });
    const earlier = session({
      id: 'b',
      startTime: '10:00',
      startsAtUtc: '2026-08-04T08:00:00.000Z',
    });

    expect(sortSessions([later, earlier]).map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('sorts anything unparseable to the end rather than corrupting the order', () => {
    const good = session({ id: 'good', startsAtUtc: '2026-08-04T09:00:00.000Z' });
    const bad = session({ id: 'bad', startsAtUtc: 'not a timestamp' });

    expect(sortSessions([bad, good]).map((row) => row.id)).toEqual(['good', 'bad']);
  });
});

describe('occupancy', () => {
  it('is not full below capacity', () => {
    const stats = occupancy({ booked: 10, capacity: 25 });
    expect(stats.isFull).toBe(false);
    expect(stats.isOverCapacity).toBe(false);
  });

  it('is full exactly at capacity, and not over it', () => {
    const stats = occupancy({ booked: 25, capacity: 25 });
    expect(stats.isFull).toBe(true);
    expect(stats.isOverCapacity).toBe(false);
  });

  it('is over capacity when an admin has deliberately overfilled a session, and that is not an error', () => {
    const stats = occupancy({ booked: 27, capacity: 25 });
    expect(stats.isFull).toBe(true);
    expect(stats.isOverCapacity).toBe(true);
  });

  it('describes booked and capacity in words', () => {
    expect(describeOccupancy(occupancy({ booked: 12, capacity: 25 }))).toBe('12 of 25 booked');
  });
});

describe('groupByDate', () => {
  it('groups consecutive sessions on the same date without reordering', () => {
    const a = session({ id: 'a', sessionDate: '2026-08-04', startTime: '09:00' });
    const b = session({ id: 'b', sessionDate: '2026-08-04', startTime: '11:00' });
    const c = session({ id: 'c', sessionDate: '2026-08-11', startTime: '09:00' });

    const groups = groupByDate([a, b, c]);

    expect(groups).toEqual([
      { date: '2026-08-04', sessions: [a, b] },
      { date: '2026-08-11', sessions: [c] },
    ]);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByDate([])).toEqual([]);
  });

  it('gives a repeated date its own second group rather than merging non-adjacent rows', () => {
    const a = session({ id: 'a', sessionDate: '2026-08-04' });
    const b = session({ id: 'b', sessionDate: '2026-08-11' });
    const c = session({ id: 'c', sessionDate: '2026-08-04' });

    const groups = groupByDate([a, b, c]);

    expect(groups.map((group) => group.date)).toEqual(['2026-08-04', '2026-08-11', '2026-08-04']);
  });
});

describe('WEEKDAY_LABELS', () => {
  it('names all seven days, Monday as 1 through Sunday as 7', () => {
    expect(WEEKDAY_LABELS[1]).toBe('Monday');
    expect(WEEKDAY_LABELS[7]).toBe('Sunday');
    expect(Object.keys(WEEKDAY_LABELS)).toHaveLength(7);
  });

  it('offers one option per weekday', () => {
    expect(WEEKDAY_OPTIONS).toHaveLength(7);
  });

  it('recognises only 1 through 7', () => {
    expect(isWeekday(1)).toBe(true);
    expect(isWeekday(7)).toBe(true);
    expect(isWeekday(0)).toBe(false);
    expect(isWeekday(8)).toBe(false);
  });
});

describe('sortRecurringSessions', () => {
  it('orders by weekday, then by start time within a day', () => {
    const thursday = recurring({ id: 'a', weekday: 4, startTime: '10:00' });
    const mondayLate = recurring({ id: 'b', weekday: 1, startTime: '14:00' });
    const mondayEarly = recurring({ id: 'c', weekday: 1, startTime: '09:00' });

    expect(sortRecurringSessions([thursday, mondayLate, mondayEarly]).map((row) => row.id)).toEqual(
      ['c', 'b', 'a'],
    );
  });
});

describe('isLocalTime', () => {
  it('accepts the server’s HH:MM shape', () => {
    expect(isLocalTime('00:00')).toBe(true);
    expect(isLocalTime('23:59')).toBe(true);
    expect(isLocalTime('09:05')).toBe(true);
  });

  it('rejects anything else, including a plausible-looking near miss', () => {
    expect(isLocalTime('24:00')).toBe(false);
    expect(isLocalTime('9:05')).toBe(false);
    expect(isLocalTime('09:5')).toBe(false);
    expect(isLocalTime('')).toBe(false);
  });
});

describe('parseWholeNumber', () => {
  const bounds = { minimum: 1, maximum: 1440 };

  it('parses a valid whole number within bounds', () => {
    expect(parseWholeNumber('90', bounds)).toEqual({ ok: true, value: 90 });
  });

  it('refuses an empty box', () => {
    expect(parseWholeNumber('', bounds)).toEqual({ ok: false, problem: 'empty' });
    expect(parseWholeNumber('   ', bounds)).toEqual({ ok: false, problem: 'empty' });
  });

  it('refuses anything that is not a whole number', () => {
    expect(parseWholeNumber('6.5', bounds)).toEqual({ ok: false, problem: 'not-a-whole-number' });
    expect(parseWholeNumber('-6', bounds)).toEqual({ ok: false, problem: 'not-a-whole-number' });
    expect(parseWholeNumber('abc', bounds)).toEqual({ ok: false, problem: 'not-a-whole-number' });
  });

  it('refuses a number below the minimum', () => {
    expect(parseWholeNumber('0', bounds)).toEqual({ ok: false, problem: 'below-minimum' });
  });

  it('refuses a number above the maximum', () => {
    expect(parseWholeNumber('1441', bounds)).toEqual({ ok: false, problem: 'above-maximum' });
  });

  it('accepts the minimum itself, including zero when the bound allows it', () => {
    expect(parseWholeNumber('0', { minimum: 0, maximum: 1000 })).toEqual({ ok: true, value: 0 });
  });
});

describe('describeLockedSession', () => {
  it('predicts the one refusal that is safe to predict: a confirmed session', () => {
    const locked = describeLockedSession({ status: 'confirmed' });
    expect(locked).toContain('confirmed');
  });

  it('does not refuse a planned, in-progress or cancelled session', () => {
    expect(describeLockedSession({ status: 'planned' })).toBeNull();
    expect(describeLockedSession({ status: 'in_progress' })).toBeNull();
    expect(describeLockedSession({ status: 'cancelled' })).toBeNull();
  });
});

describe('describeMaterialisation', () => {
  it('pluralises a real count', () => {
    expect(describeMaterialisation({ sessionsCreated: 6 })).toBe(
      'Created 6 sessions from the weekly templates.',
    );
    expect(describeMaterialisation({ sessionsCreated: 1 })).toBe(
      'Created 1 session from the weekly templates.',
    );
  });

  it('treats zero as up to date, because the job is idempotent', () => {
    expect(describeMaterialisation({ sessionsCreated: 0 })).toBe(
      'No new sessions — every session up to six weeks ahead already existed.',
    );
  });

  // The generated types mark every field on the job report optional, since
  // `openapi.yaml` gives it no `required:` array. Defaulting to zero would make
  // a confident claim the response never made.
  it('does not invent a count of zero when the field is absent', () => {
    expect(describeMaterialisation({})).toBe('Sessions generated from the weekly templates.');
  });
});
