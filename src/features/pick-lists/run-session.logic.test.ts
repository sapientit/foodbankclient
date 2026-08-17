import { describe, expect, it } from 'vitest';
import { describeReadOnlySession, isSessionReadOnly, parcelStatus } from './run-session.logic';
import type { Parcel } from './queries';

const BASE_PARCEL: Parcel = {
  id: 'parcel-1',
  referralId: 'referral-1',
  pickNumber: 1,
  refereeFirstName: 'Sam',
  refereeSurname: 'Taylor',
  isDelivery: false,
  adults: 1,
  children: 1,
  householdSize: 2,
  reviewedAt: null,
  attendance: 'pending',
  notes: null,
  answers: {},
  lines: [],
};

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

describe('parcelStatus', () => {
  it('reads "Attended" for a collection and "Delivered" for a delivery', () => {
    const collection: Parcel = { ...BASE_PARCEL, attendance: 'attended', isDelivery: false };
    const delivery: Parcel = { ...BASE_PARCEL, attendance: 'attended', isDelivery: true };

    expect(parcelStatus(collection)).toEqual({ state: 'attended', label: 'Attended' });
    expect(parcelStatus(delivery)).toEqual({ state: 'attended', label: 'Delivered' });
  });

  it('reads "No show" for a collection and "Not in" for a delivery', () => {
    const collection: Parcel = { ...BASE_PARCEL, attendance: 'no_show', isDelivery: false };
    const delivery: Parcel = { ...BASE_PARCEL, attendance: 'no_show', isDelivery: true };

    expect(parcelStatus(collection)).toEqual({ state: 'no_show', label: 'No show' });
    expect(parcelStatus(delivery)).toEqual({ state: 'no_show', label: 'Not in' });
  });

  it('is "Pending Review" before a pick list has been reviewed, whichever way the outcome will go', () => {
    const parcel: Parcel = { ...BASE_PARCEL, attendance: 'pending', reviewedAt: null };

    expect(parcelStatus(parcel)).toEqual({ state: 'pending', label: 'Pending Review' });
  });

  it('is "Pick List reviewed" once reviewed but before an outcome is recorded', () => {
    const parcel: Parcel = {
      ...BASE_PARCEL,
      attendance: 'pending',
      reviewedAt: '2026-08-05T10:00:00.000Z',
    };

    expect(parcelStatus(parcel)).toEqual({ state: 'reviewed', label: 'Pick List reviewed' });
  });
});
