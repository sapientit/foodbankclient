import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getVolunteerCode,
  normaliseVolunteerCode,
  setVolunteerCode,
  subscribeToVolunteerCode,
} from './volunteer-code-store';

/**
 * The pure in-memory store `auth-fetch` reads on every request and the counting
 * screen swaps its view on. Tested directly — no React, no MSW.
 */

afterEach(() => {
  // The code lives at module level; every test starts from empty.
  setVolunteerCode(null);
});

describe('normaliseVolunteerCode', () => {
  it('trims surrounding whitespace and uppercases', () => {
    expect(normaliseVolunteerCode('  kp7q-4xzm  ')).toBe('KP7Q-4XZM');
  });

  it('leaves the internal dashes alone', () => {
    expect(normaliseVolunteerCode('kp7q-4xzm-9rtw-2njh')).toBe('KP7Q-4XZM-9RTW-2NJH');
  });
});

describe('the volunteer code store', () => {
  it('normalises the value it stores', () => {
    setVolunteerCode('  kp7q-4xzm-9rtw-2njh  ');
    expect(getVolunteerCode()).toBe('KP7Q-4XZM-9RTW-2NJH');
  });

  it('reflects the last value that was set', () => {
    setVolunteerCode('aaaa-1111');
    setVolunteerCode('bbbb-2222');
    expect(getVolunteerCode()).toBe('BBBB-2222');
  });

  it('clears the code when set to null', () => {
    setVolunteerCode('aaaa-1111');
    setVolunteerCode(null);
    expect(getVolunteerCode()).toBeNull();
  });

  it('notifies subscribers on set and on clear', () => {
    const listener = vi.fn();
    subscribeToVolunteerCode(listener);

    setVolunteerCode('aaaa-1111');
    setVolunteerCode(null);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying a subscriber once it has unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToVolunteerCode(listener);

    unsubscribe();
    setVolunteerCode('aaaa-1111');

    expect(listener).not.toHaveBeenCalled();
  });
});
