import { describe, expect, it } from 'vitest';
import {
  DAYS_AHEAD,
  DAYS_BACK,
  defaultSessionDateRange,
  filterSessionsByStatus,
  isClosedSession,
  openSessionTargets,
  readSessionListSelection,
} from './session-list-filters.logic';

describe('defaultSessionDateRange', () => {
  it('reaches a fortnight either side of today', () => {
    expect(defaultSessionDateRange('2026-08-17')).toEqual({
      from: '2026-08-03',
      to: '2026-08-31',
    });
    expect(DAYS_BACK).toBe(14);
    expect(DAYS_AHEAD).toBe(14);
  });

  it('crosses a month and a year end without arithmetic of its own', () => {
    expect(defaultSessionDateRange('2026-01-07')).toEqual({
      from: '2025-12-24',
      to: '2026-01-21',
    });
  });

  it('is unmoved by the clocks going forward', () => {
    // BST begins on 29 March 2026. A window built by adding milliseconds to a
    // local instant would land an hour out and report the 15th here.
    expect(defaultSessionDateRange('2026-03-30').from).toBe('2026-03-16');
  });
});

describe('readSessionListSelection', () => {
  const today = '2026-08-17';

  it('falls back to the default window when the query string says nothing', () => {
    expect(readSessionListSelection(new URLSearchParams(), today)).toEqual({
      from: '2026-08-03',
      to: '2026-08-31',
      showCompleted: false,
    });
  });

  it('takes both dates from the query string when they are real dates', () => {
    const params = new URLSearchParams({ from: '2026-01-01', to: '2026-02-01' });
    const selection = readSessionListSelection(params, today);
    expect(selection.from).toBe('2026-01-01');
    expect(selection.to).toBe('2026-02-01');
  });

  it('falls back rather than passing on a date the server would refuse', () => {
    // A hand-edited or stale link. A list a fortnight either side of today is
    // always a defensible answer; a 400 in front of a volunteer is not.
    const params = new URLSearchParams({ from: 'last week', to: '2026-02-30' });
    const selection = readSessionListSelection(params, today);
    expect(selection.from).toBe('2026-08-03');
    expect(selection.to).toBe('2026-08-31');
  });

  it('shows completed sessions only when the query string asks for it exactly', () => {
    expect(readSessionListSelection(new URLSearchParams(), today).showCompleted).toBe(false);
    expect(
      readSessionListSelection(new URLSearchParams({ completed: 'true' }), today).showCompleted,
    ).toBe(true);
    expect(
      readSessionListSelection(new URLSearchParams({ completed: 'yes' }), today).showCompleted,
    ).toBe(false);
  });
});

describe('filterSessionsByStatus', () => {
  const sessions = [
    { id: 'a', status: 'planned' as const },
    { id: 'b', status: 'in_progress' as const },
    { id: 'c', status: 'confirmed' as const },
    { id: 'd', status: 'cancelled' as const },
  ];

  it('shows only what is still open by default', () => {
    expect(filterSessionsByStatus(sessions, false).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('shows the cancelled as well as the completed when asked, because nothing else reaches one', () => {
    expect(filterSessionsByStatus(sessions, true).map((row) => row.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('does not reorder what it was given', () => {
    const reversed = [...sessions].reverse();
    expect(filterSessionsByStatus(reversed, true).map((row) => row.id)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
  });
});

describe('isClosedSession', () => {
  const today = '2026-08-17';

  it('is closed once confirmed or cancelled, even today or in the future', () => {
    expect(isClosedSession({ status: 'confirmed', sessionDate: '2026-08-20' }, today)).toBe(true);
    expect(isClosedSession({ status: 'cancelled', sessionDate: '2026-08-20' }, today)).toBe(true);
  });

  it('is closed once its own date has passed, even while still planned', () => {
    expect(isClosedSession({ status: 'planned', sessionDate: '2026-08-16' }, today)).toBe(true);
  });

  it('is open today and going forward while still planned or in progress', () => {
    expect(isClosedSession({ status: 'planned', sessionDate: today }, today)).toBe(false);
    expect(isClosedSession({ status: 'in_progress', sessionDate: '2026-08-25' }, today)).toBe(
      false,
    );
  });
});

describe('openSessionTargets', () => {
  const today = '2026-08-17';
  const sessions = [
    { id: 'past', status: 'planned' as const, sessionDate: '2026-08-16' },
    { id: 'today', status: 'planned' as const, sessionDate: today },
    { id: 'future', status: 'in_progress' as const, sessionDate: '2026-08-24' },
    { id: 'confirmed', status: 'confirmed' as const, sessionDate: '2026-08-24' },
    { id: 'cancelled', status: 'cancelled' as const, sessionDate: '2026-08-24' },
  ];

  it('offers only what is neither past nor closed', () => {
    expect(openSessionTargets(sessions, today).map((row) => row.id)).toEqual(['today', 'future']);
  });
});
