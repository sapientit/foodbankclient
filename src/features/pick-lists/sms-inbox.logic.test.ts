import { describe, expect, it } from 'vitest';
import { groupByPhone } from './sms-inbox.logic';
import type { SmsInboxMessage } from './queries';

function message(
  overrides: Partial<SmsInboxMessage> & Pick<SmsInboxMessage, 'id'>,
): SmsInboxMessage {
  return {
    referralId: null,
    kind: 'household_reply',
    body: 'Test message',
    occurredAt: '2026-08-20T09:00:00.000Z',
    readAt: null,
    recipientRole: null,
    location: 'unmatched',
    session: null,
    simulated: false,
    phone: '+441111111111',
    ...overrides,
  };
}

describe('groupByPhone', () => {
  it('merges several messages from the same phone into one group', () => {
    const groups = groupByPhone([
      message({ id: 'm1', phone: '+441111111111', occurredAt: '2026-08-20T09:00:00.000Z' }),
      message({ id: 'm2', phone: '+441111111111', occurredAt: '2026-08-21T09:00:00.000Z' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('keeps different phones as separate groups', () => {
    const groups = groupByPhone([
      message({ id: 'm1', phone: '+441111111111' }),
      message({ id: 'm2', phone: '+442222222222' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.phone).sort()).toEqual(['+441111111111', '+442222222222']);
  });

  it('sorts messages within a group oldest first, regardless of input order', () => {
    const groups = groupByPhone([
      message({ id: 'newer', occurredAt: '2026-08-22T09:00:00.000Z' }),
      message({ id: 'older', occurredAt: '2026-08-20T09:00:00.000Z' }),
      message({ id: 'middle', occurredAt: '2026-08-21T09:00:00.000Z' }),
    ]);

    expect(groups[0]?.messages.map((m) => m.id)).toEqual(['older', 'middle', 'newer']);
  });

  it('sorts groups newest-message-first', () => {
    const groups = groupByPhone([
      message({ id: 'a-old', phone: '+441111111111', occurredAt: '2026-08-10T09:00:00.000Z' }),
      message({ id: 'b-new', phone: '+442222222222', occurredAt: '2026-08-25T09:00:00.000Z' }),
      message({ id: 'a-newer', phone: '+441111111111', occurredAt: '2026-08-15T09:00:00.000Z' }),
    ]);

    // Phone 1's most recent message (Aug 15) is still older than phone 2's
    // only message (Aug 25), so phone 2's group sorts first.
    expect(groups.map((g) => g.phone)).toEqual(['+442222222222', '+441111111111']);
  });

  it('counts unread household and referrer replies as unreadReplyIds', () => {
    const groups = groupByPhone([
      message({ id: 'unread-reply', kind: 'household_reply', readAt: null }),
      message({ id: 'read-reply', kind: 'household_reply', readAt: '2026-08-20T10:00:00.000Z' }),
      message({ id: 'referrer-reply', kind: 'referrer_reply', readAt: null }),
      message({ id: 'reminder', kind: 'reminder', readAt: null }),
      message({ id: 'staff-reply', kind: 'staff_reply', readAt: null }),
      message({ id: 'failure', kind: 'failure', readAt: null }),
    ]);

    expect(groups[0]?.unreadReplyIds).toEqual(['unread-reply', 'referrer-reply']);
  });

  it('lists distinct referralIds most-recent-message-first, for a phone reused across referrals', () => {
    const groups = groupByPhone([
      message({
        id: 'm1',
        referralId: 'referral-old',
        occurredAt: '2026-08-01T09:00:00.000Z',
        location: 'closed_session',
      }),
      message({
        id: 'm2',
        referralId: 'referral-old',
        occurredAt: '2026-08-02T09:00:00.000Z',
        location: 'closed_session',
      }),
      message({
        id: 'm3',
        referralId: 'referral-new',
        occurredAt: '2026-08-20T09:00:00.000Z',
        location: 'closed_session',
      }),
    ]);

    expect(groups[0]?.referralIds).toEqual(['referral-new', 'referral-old']);
  });

  it('returns an empty referralIds array for an unmatched (loose) group, not [null]', () => {
    const groups = groupByPhone([
      message({ id: 'm1', referralId: null, location: 'unmatched' }),
      message({ id: 'm2', referralId: null, location: 'unmatched' }),
    ]);

    expect(groups[0]?.referralIds).toEqual([]);
  });

  it('groups a null phone (no number on file) by referralId, never merging two different households', () => {
    const groups = groupByPhone([
      message({
        id: 'm1',
        phone: null,
        referralId: 'referral-a',
        kind: 'failure',
        readAt: '2026-08-20T09:00:00.000Z',
        location: 'closed_session',
      }),
      message({
        id: 'm2',
        phone: null,
        referralId: 'referral-b',
        kind: 'failure',
        readAt: '2026-08-20T09:00:00.000Z',
        location: 'closed_session',
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.referralIds)).toEqual(
      expect.arrayContaining([['referral-a'], ['referral-b']]),
    );
    expect(groups.every((g) => g.phone === null)).toBe(true);
    // Distinct keys even though `phone` is the same (null) on both.
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
  });

  it('keeps two messages for the same referralId with a null phone in one group', () => {
    const groups = groupByPhone([
      message({
        id: 'm1',
        phone: null,
        referralId: 'referral-a',
        kind: 'failure',
        occurredAt: '2026-08-20T09:00:00.000Z',
        readAt: '2026-08-20T09:00:00.000Z',
        location: 'closed_session',
      }),
      message({
        id: 'm2',
        phone: null,
        referralId: 'referral-a',
        kind: 'staff_reply',
        occurredAt: '2026-08-21T09:00:00.000Z',
        readAt: '2026-08-21T09:00:00.000Z',
        location: 'closed_session',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('reports hasFailure true when any message in the group is a failure', () => {
    const groups = groupByPhone([
      message({ id: 'm1', kind: 'household_reply' }),
      message({ id: 'm2', kind: 'failure' }),
    ]);

    expect(groups[0]?.hasFailure).toBe(true);
  });

  it('reports hasFailure false when no message in the group is a failure', () => {
    const groups = groupByPhone([
      message({ id: 'm1', kind: 'household_reply' }),
      message({ id: 'm2', kind: 'reminder' }),
    ]);

    expect(groups[0]?.hasFailure).toBe(false);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupByPhone([])).toEqual([]);
  });
});
