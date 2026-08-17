import { describe, expect, it } from 'vitest';
import { describeReadOnlySession, isSessionReadOnly } from './run-session.logic';

describe('isSessionReadOnly', () => {
  it('is a session still being run, or still waiting to be', () => {
    expect(isSessionReadOnly('planned')).toBe(false);
    expect(isSessionReadOnly('in_progress')).toBe(false);
  });

  it('covers the cancelled as well as the confirmed', () => {
    // The two are frozen for different reasons — one signed off, the other
    // never ran — but the server refuses the same writes on both, so a screen
    // that only checked for `confirmed` would offer a cancelled session
    // controls that can only fail.
    expect(isSessionReadOnly('confirmed')).toBe(true);
    expect(isSessionReadOnly('cancelled')).toBe(true);
  });
});

describe('describeReadOnlySession', () => {
  it('says nothing while the session can still be changed', () => {
    expect(describeReadOnlySession('planned')).toBeNull();
    expect(describeReadOnlySession('in_progress')).toBeNull();
  });

  it('gives the two frozen states their own reason', () => {
    const confirmed = describeReadOnlySession('confirmed');
    const cancelled = describeReadOnlySession('cancelled');

    expect(confirmed).toContain('completed');
    expect(cancelled).toContain('cancelled');
    expect(confirmed).not.toBe(cancelled);
  });
});
