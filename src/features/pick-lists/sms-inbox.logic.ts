import type { SmsInboxMessage } from './queries';

/**
 * One phone number's thread inside the administrator inbox — the unit
 * `SmsInboxThread` renders, and the shape `groupByPhone` builds it into.
 *
 * The caller filters `useSmsInbox()`'s flat list by `location`
 * (`active_session` / `closed_session` / `unmatched`) **before** calling
 * `groupByPhone`; grouping itself does not know or care which section a
 * message belongs to, the same way the server's own filtering (only numbers
 * with something besides a `reminder`) is already done by the time the
 * response reaches this client.
 */
export interface SmsPhoneGroup {
  /** Stable identity for this group — a React key and the grouping map's own key. */
  readonly key: string;
  /** `null` when the household this thread belongs to has no number on file. */
  readonly phone: string | null;
  /** Oldest first, matching `GET /referrals/{id}/sms-messages`'s thread order. */
  readonly messages: SmsInboxMessage[];
  readonly unreadReplyIds: string[];
  /** Distinct, non-null, most-recent-message-first. Empty for an `unmatched` group. */
  readonly referralIds: string[];
  readonly hasFailure: boolean;
}

/**
 * `phone` is nullable (`openapi.yaml`, `SmsInboxMessage.phone`): a household
 * with no number on file still gets a `reminder`/`staff_reply`/`failure` row
 * with `phone: null`. The contract is explicit that two `null`-phone rows
 * are never the same thread — group those by `referralId` instead. Only a
 * session-linked message can have a null phone (an inbound reply always
 * carries a real sender number), so `referralId` is always present when
 * `phone` is not.
 */
function groupKey(message: SmsInboxMessage): string {
  return message.phone !== null
    ? `phone:${message.phone}`
    : `referral:${String(message.referralId)}`;
}

/**
 * Groups whatever it is given by `phone` (or by `referralId` for a
 * no-number-on-file household), newest-message-first between groups and
 * oldest-first within one — the reverse of the order `GET /sms-messages`
 * itself arrives in, so this is a re-sort for display, not a pass-through.
 */
export function groupByPhone(messages: readonly SmsInboxMessage[]): SmsPhoneGroup[] {
  const byKey = new Map<string, SmsInboxMessage[]>();
  for (const message of messages) {
    const key = groupKey(message);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, [message]);
    } else {
      existing.push(message);
    }
  }

  const groups: SmsPhoneGroup[] = [...byKey.entries()].map(([key, phoneMessages]) => {
    // `messages` arrives newest-first; keep a newest-first copy to derive
    // `referralIds` from, and a separate oldest-first copy for display.
    const newestFirst = [...phoneMessages].sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
    );
    const oldestFirst = [...newestFirst].reverse();

    const referralIds: string[] = [];
    for (const message of newestFirst) {
      if (message.referralId !== null && !referralIds.includes(message.referralId)) {
        referralIds.push(message.referralId);
      }
    }

    const unreadReplyIds = phoneMessages
      .filter((message) => message.kind === 'household_reply' && message.readAt === null)
      .map((message) => message.id);

    return {
      key,
      phone: newestFirst[0]?.phone ?? null,
      messages: oldestFirst,
      unreadReplyIds,
      referralIds,
      hasFailure: phoneMessages.some((message) => message.kind === 'failure'),
    };
  });

  // Newest-message-first between groups. Each group's most recent message is
  // the last one in its (oldest-first) `messages` array.
  groups.sort((a, b) => {
    const aLast = a.messages.at(-1);
    const bLast = b.messages.at(-1);
    const aTime = aLast === undefined ? 0 : Date.parse(aLast.occurredAt);
    const bTime = bLast === undefined ? 0 : Date.parse(bLast.occurredAt);
    return bTime - aTime;
  });

  return groups;
}
