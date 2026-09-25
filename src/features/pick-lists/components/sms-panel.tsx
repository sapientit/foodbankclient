import { useRef, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { classNames } from '../../../lib/class-names';
import { ApiError, isNotFound } from '../../../lib/errors';
import { formatLondonDateTime, formatSessionDate } from '../../../lib/london-time';
import { useReferral, useReferralSearchMemory } from '../../referrals/queries';
import { useSession } from '../../sessions/queries';
import type {
  Parcel,
  SmsCandidateParcel,
  SmsInboxMessage,
  SmsMessage,
  SmsReminderResult,
} from '../queries';
import { isCurrentParcel, isSessionReadOnly } from '../run-session.logic';
import { groupByPhone, type SmsPhoneGroup } from '../sms-inbox.logic';
import { formatSmsReminderOutcome, formatSmsReplyOutcome } from '../sms-outcomes';
import {
  useMarkSmsRead,
  useMarkSmsInboxMessageRead,
  useReplyBySms,
  useSendSmsReminders,
  useSessionPickList,
  useSmsSummary,
  useSmsThread,
  useSmsInbox,
} from '../queries';
import styles from './sms-panel.module.css';

/**
 * The fields `SmsThreadMessages` renders, shared between `SmsMessage` (a
 * referral's own thread) and `SmsInboxMessage` (the admin inbox) rather than
 * a union of the two — both already carry these with the same types, so a
 * structural `Pick` lets one renderer serve both without either screen's
 * hook feeding it a shape it doesn't produce.
 */
type ThreadMessage = Pick<
  SmsMessage,
  'id' | 'kind' | 'recipientRole' | 'simulated' | 'body' | 'occurredAt'
>;

/**
 * The message list both `SmsConversation` (a team lead's own thread) and
 * `SmsInboxThread` (the admin inbox) show once expanded — extracted so the
 * two accordions cannot drift in what a message reads as.
 */
function SmsThreadMessages({ messages }: { messages: readonly ThreadMessage[] }) {
  return (
    <ol className={styles.thread}>
      {messages.map((message) => (
        <li key={message.id}>
          <strong>
            {message.kind === 'referrer_reply'
              ? 'reply from referrer'
              : message.kind.replace('_', ' ')}
            {message.simulated && ' (simulated)'}
          </strong>{' '}
          {message.recipientRole !== null &&
            message.kind !== 'household_reply' &&
            message.kind !== 'referrer_reply' &&
            ` to ${message.recipientRole}`}{' '}
          — {message.body}{' '}
          <time dateTime={message.occurredAt}>{formatLondonDateTime(message.occurredAt)}</time>
        </li>
      ))}
    </ol>
  );
}

/** The same reminder send is available on Text messages and the Clients tab. */
export function SmsRemindersAction({ sessionId }: { readonly sessionId: string }) {
  const send = useSendSmsReminders();
  const sending = useRef(false);
  const [result, setResult] = useState<SmsReminderResult>();

  return (
    <>
      <button
        aria-disabled={send.isPending}
        onClick={() => {
          if (sending.current) return;
          sending.current = true;
          send.mutate(sessionId, {
            onSuccess: (response) => {
              setResult(response);
            },
            onError: (error) => {
              // A network or 5xx failure may have sent the reminder already;
              // only a refusal proves that it is safe to offer another attempt.
              if (error instanceof ApiError && error.status >= 400 && error.status < 500)
                sending.current = false;
            },
          });
        }}
        type="button"
      >
        {send.isPending ? 'Sending SMS reminders…' : 'Send SMS reminders'}
      </button>
      {send.isError && <ErrorNotice error={send.error} />}
      {result !== undefined && (
        <p role="status">
          {formatSmsReminderOutcome(result)}
          {result.failed > 0 && <strong> Failed reminders need attention.</strong>}
        </p>
      )}
    </>
  );
}

/**
 * `readOnly` is the containing session being finished with, and it takes every
 * write on this panel away: no reminders, no replies, and **opening a
 * conversation no longer marks it read**. That last one is the easy one to miss
 * — it is a write with no button in front of it — and marking a year-old thread
 * read by scrolling past it loses the only signal an administrator has that
 * somebody said something nobody answered.
 *
 * The server does not enforce any of this: neither
 * `POST /sessions/{id}/sms-reminders` nor `POST /referrals/{id}/sms-messages`
 * carries a confirmed-session rule. It is this client's decision, and it is
 * written down in `screenDetails.md` rather than left implicit here.
 */
export function SessionSmsPanel({
  sessionId,
  parcels,
  readOnly,
}: {
  sessionId: string;
  parcels: Parcel[];
  readOnly: boolean;
}) {
  // The app's one sanctioned poll exists for a session being run. On a finished
  // one it is a request every five seconds for a number that cannot change.
  const summary = useSmsSummary(sessionId, !readOnly);
  const countFor = (referralId: string) =>
    summary.data?.households.find((household) => household.referralId === referralId);

  return (
    <section aria-labelledby="sms-heading">
      <h2 id="sms-heading">Text messages</h2>
      {summary.isPending && <Spinner label="Loading message counts…" />}
      {summary.isError && (
        <ErrorNotice error={summary.error} onRetry={() => void summary.refetch()} />
      )}
      {!readOnly && <SmsRemindersAction sessionId={sessionId} />}
      <ul className={styles.households}>
        {parcels.map((parcel) => {
          const count = countFor(parcel.referralId);
          return (
            <SmsConversation
              key={parcel.referralId}
              name={`${parcel.refereeFirstName ?? 'Unknown'} ${parcel.refereeSurname ?? ''}`.trim()}
              readOnly={readOnly}
              referralId={parcel.referralId}
              unreadCount={count?.unreadCount ?? 0}
              messageCount={count?.messageCount ?? 0}
            />
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The Text messages tab, one of the five destinations `RunSessionTabs`
 * offers. `SessionSmsPanel` is unchanged; this just gives it the route,
 * its own data and its own `<h1>` — the unread total that used to sit at
 * the top of this panel now lives on the tab itself as a badge, so it is
 * not shown twice.
 */
export function RunSessionMessagesScreen() {
  const { sessionId = '' } = useParams();
  const session = useSession(sessionId);
  const pickList = useSessionPickList(sessionId);

  if (session.isPending || pickList.isPending)
    return (
      <div className={styles.page}>
        <Spinner label="Loading messages…" />
      </div>
    );
  if (session.isError)
    return (
      <div className={styles.page}>
        <ErrorNotice error={session.error} onRetry={() => void session.refetch()} />
      </div>
    );
  /*
   * A session nobody has opened yet has no pick list — reconciliation only
   * runs from the Clients tab — and reaching this tab first (a bookmark, a
   * shared link, browser back/forward) is the one way here that isn't. A
   * plain 404 would otherwise read as "That no longer exists", which is
   * wrong for a session that plainly exists; `ListenerSheetScreen` has the
   * same shape of problem for its own endpoint and takes the same approach:
   * name what is actually true and point back to where it gets fixed.
   */
  if (pickList.isError && isNotFound(pickList.error))
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Text messages" />
        </div>
        <p>
          This session's pick lists have not been prepared yet.{' '}
          <Link to={`/run-sessions/${sessionId}`}>Open the Clients tab</Link> first, which prepares
          them.
        </p>
      </div>
    );
  if (pickList.isError)
    return (
      <div className={styles.page}>
        <ErrorNotice error={pickList.error} onRetry={() => void pickList.refetch()} />
      </div>
    );

  const currentParcels = pickList.data.parcels.filter(isCurrentParcel);

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Text messages" />
      </div>
      <SessionSmsPanel
        parcels={currentParcels}
        readOnly={isSessionReadOnly(session.data.status)}
        sessionId={sessionId}
      />
    </div>
  );
}

function SmsConversation({
  referralId,
  name,
  readOnly,
  unreadCount,
  messageCount,
}: {
  referralId: string;
  name: string;
  readOnly: boolean;
  unreadCount: number;
  messageCount: number;
}) {
  const [open, setOpen] = useState(false);
  const thread = useSmsThread(referralId, open);
  const markRead = useMarkSmsRead();
  const reply = useReplyBySms();
  const [body, setBody] = useState('');
  const [replyResult, setReplyResult] = useState<'sent' | 'simulated'>();
  return (
    <li>
      <details
        onToggle={(event) => {
          const expanded = event.currentTarget.open;
          setOpen(expanded);
          if (expanded && unreadCount > 0 && !readOnly) markRead.mutate(referralId);
        }}
      >
        <summary className={unreadCount > 0 ? styles.unreadButton : undefined}>
          {name}: {messageCount} {messageCount === 1 ? 'message' : 'messages'}
          {unreadCount > 0 && `, ${String(unreadCount)} unread`}
        </summary>
        {thread.isPending && <Spinner label="Loading messages…" />}
        {thread.isError && (
          <ErrorNotice error={thread.error} onRetry={() => void thread.refetch()} />
        )}
        {thread.data !== undefined && <SmsThreadMessages messages={thread.data.messages} />}
        {!readOnly && (
          <>
            <label>
              Reply by SMS
              <textarea
                maxLength={480}
                onChange={(event) => {
                  setBody(event.target.value);
                }}
                value={body}
              />
            </label>
            <p className={styles.warning}>
              Do not include the household’s name, address, or anything that identifies them.
            </p>
            <button
              disabled={body.trim() === '' || reply.isPending}
              onClick={() => {
                reply.mutate(
                  { referralId, body: body.trim() },
                  {
                    onSuccess: (message) => {
                      setBody('');
                      setReplyResult(message.simulated ? 'simulated' : 'sent');
                    },
                  },
                );
              }}
              type="button"
            >
              Send reply
            </button>
            {reply.isError && <ErrorNotice error={reply.error} />}
            {replyResult !== undefined && (
              <p role="status">{formatSmsReplyOutcome(replyResult === 'simulated')}</p>
            )}
          </>
        )}
      </details>
    </li>
  );
}

/**
 * The administrator inbox has separate routes for referrer, closed-session,
 * unknown-number, and normal (active-session) messages. A referrer reply can
 * concern several households and must remain administrator-only; a closed
 * session needs administrator follow-up; normal messages stay with the team
 * leader currently running that session.
 *
 * Modelled on `RunSessionLayout`/`RunSessionTabs`: real routes, not a
 * same-page filter, and each tab fetches `useSmsInbox()` again rather than
 * threading it down — the query cache shares the one request across the tab
 * strip and whichever tab is open, the same way `useSessionPickList` does
 * there.
 */
export function SmsInboxLayout() {
  return (
    <>
      <SmsInboxTabs />
      <Outlet />
    </>
  );
}

/**
 * Each tab has its own unread badge, matching its own attention-summary
 * field. The normal-message count remains visible to an administrator even
 * though active-session replies are the team leader's to read.
 */
function SmsInboxTabs() {
  const inbox = useSmsInbox();
  const messages = inbox.data?.messages ?? [];
  const unknownUnread = unreadCount(messages, 'unmatched');
  const closedUnread = unreadCount(messages, 'closed_session');
  const normalUnread = unreadCount(messages, 'active_session');
  const referrerUnread = messages.filter(
    (message) => message.kind === 'referrer_reply' && message.readAt === null,
  ).length;

  return (
    <nav aria-label="SMS Messages navigation" className={styles.tabs}>
      <ul className={styles.tabList}>
        <li>
          <NavLink
            aria-label={
              referrerUnread > 0
                ? `Referrer messages (${String(referrerUnread)} unread)`
                : undefined
            }
            end
            to="/sms"
          >
            Referrer messages
            {referrerUnread > 0 && (
              <span aria-hidden="true" className={styles.badge}>
                {referrerUnread}
              </span>
            )}
          </NavLink>
        </li>
        <li>
          <NavLink
            aria-label={
              closedUnread > 0
                ? `Closed session messages (${String(closedUnread)} unread)`
                : undefined
            }
            to="/sms/closed"
          >
            Closed session messages
            {closedUnread > 0 && (
              <span aria-hidden="true" className={styles.badge}>
                {closedUnread}
              </span>
            )}
          </NavLink>
        </li>
        <li>
          <NavLink
            aria-label={
              unknownUnread > 0 ? `Unknown messages (${String(unknownUnread)} unread)` : undefined
            }
            to="/sms/unknown"
          >
            Unknown messages
            {unknownUnread > 0 && (
              <span aria-hidden="true" className={styles.badge}>
                {unknownUnread}
              </span>
            )}
          </NavLink>
        </li>
        <li>
          <NavLink
            aria-label={
              normalUnread > 0 ? `Normal messages (${String(normalUnread)} unread)` : undefined
            }
            to="/sms/normal"
          >
            Normal messages
            {normalUnread > 0 && (
              <span aria-hidden="true" className={styles.badge}>
                {normalUnread}
              </span>
            )}
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}

function unreadCount(
  messages: readonly SmsInboxMessage[],
  location: SmsInboxMessage['location'],
): number {
  return messages.filter(
    (message) =>
      message.location === location &&
      message.kind === 'household_reply' &&
      message.readAt === null,
  ).length;
}

export function SmsNormalMessagesScreen() {
  const inbox = useSmsInbox();
  const active = groupByPhone(
    (inbox.data?.messages ?? []).filter((message) => message.location === 'active_session'),
  );
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Normal messages" />
      </div>
      <p>
        Messages tied to a session still planned or under way. They remain the team leader's to read
        and are not marked read here.
      </p>
      {inbox.isPending && <Spinner label="Loading SMS messages…" />}
      {inbox.isError && <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data !== undefined &&
        (active.length === 0 ? (
          <EmptyState
            headline="No normal messages"
            sentence="Nothing from a session still planned or under way in the last thirty days."
          />
        ) : (
          <SmsInboxGroupSection
            heading="Messages for active sessions"
            groups={active}
            markReadMode="none"
          />
        ))}
    </div>
  );
}

export function SmsClosedMessagesScreen() {
  const inbox = useSmsInbox();
  const groups = groupByPhone(
    (inbox.data?.messages ?? []).filter((message) => message.location === 'closed_session'),
  );
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Closed session messages" />
      </div>
      <p>
        Messages from sessions that have closed. Opening a conversation marks its unread replies
        read.
      </p>
      {inbox.isPending && <Spinner label="Loading SMS messages…" />}
      {inbox.isError && <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data !== undefined &&
        (groups.length === 0 ? (
          <EmptyState
            headline="No closed session messages"
            sentence="Nothing from a closed session in the last thirty days."
          />
        ) : (
          <ul className={styles.messageList}>
            {groups.map((group) => (
              <SmsInboxThread key={group.key} group={group} markReadMode="referral" />
            ))}
          </ul>
        ))}
    </div>
  );
}

export function SmsUnknownMessagesScreen() {
  const inbox = useSmsInbox();
  const groups = groupByPhone(
    (inbox.data?.messages ?? []).filter(
      (message) => message.location === 'unmatched' && message.kind !== 'referrer_reply',
    ),
  );
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Unknown messages" />
      </div>
      <p>
        A reply with no referral behind it at all — a wrong number, or somebody the food bank has
        never heard of. The phone number is the only way to act on one of these.
      </p>
      {inbox.isPending && <Spinner label="Loading SMS messages…" />}
      {inbox.isError && <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data !== undefined &&
        (groups.length === 0 ? (
          <EmptyState
            headline="No unknown messages"
            sentence="Nothing without a referral behind it in the last thirty days."
          />
        ) : (
          <ul className={styles.messageList}>
            {groups.map((group) => (
              <SmsInboxThread key={group.key} group={group} markReadMode="message" />
            ))}
          </ul>
        ))}
    </div>
  );
}

/**
 * Referrer replies cannot belong to one household's SMS thread: a referrer may
 * be collecting for several households, and the server deliberately returns
 * all currently-open possibilities rather than guessing. This is therefore an
 * administrator-only inbox route, separate from unknown messages even though
 * the underlying messages have no one session attached.
 */
export function SmsReferrerMessagesScreen() {
  const inbox = useSmsInbox();
  const groups = groupByPhone(
    (inbox.data?.messages ?? []).filter((message) => message.kind === 'referrer_reply'),
  );
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Referrer messages" />
      </div>
      <p>
        Replies from referrers collecting parcels for someone else. Each reply shows every open
        parcel it could concern; choose the relevant referral yourself.
      </p>
      {inbox.isPending && <Spinner label="Loading referrer messages…" />}
      {inbox.isError && <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data !== undefined &&
        (groups.length === 0 ? (
          <EmptyState
            headline="No referrer messages"
            sentence="No referrer collection replies in the last thirty days."
          />
        ) : (
          <ul className={styles.messageList}>
            {groups.map((group) => (
              <SmsInboxThread key={group.key} group={group} markReadMode="message" />
            ))}
          </ul>
        ))}
    </div>
  );
}

function SmsInboxGroupSection({
  heading,
  groups,
  markReadMode,
}: {
  heading: string;
  groups: SmsPhoneGroup[];
  markReadMode: 'referral' | 'none';
}) {
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby={`sms-${heading.replaceAll(' ', '-').toLowerCase()}`}>
      <h2 id={`sms-${heading.replaceAll(' ', '-').toLowerCase()}`}>{heading}</h2>
      <ul className={styles.messageList}>
        {groups.map((group) => (
          <SmsInboxThread key={group.key} group={group} markReadMode={markReadMode} />
        ))}
      </ul>
    </section>
  );
}

function hasSession(
  message: SmsInboxMessage,
): message is SmsInboxMessage & { session: NonNullable<SmsInboxMessage['session']> } {
  return message.session !== null;
}

/**
 * One phone number's thread in the administrator inbox — an accordion, the
 * same shape as `SmsConversation`'s. `markReadMode` is what tells it whether
 * opening the thread is allowed to mark anything read, and by which call:
 *
 * - `'referral'` — a closed-session thread. Marking read is
 *   `POST /referrals/{id}/sms-messages/read`, the same call a team lead's own
 *   thread view uses, looped once per `referralIds` entry because a phone
 *   reused across a repeat referral can carry unread replies against more
 *   than one.
 * - `'message'` — an unknown or referrer thread with no single referral to mark
 *   read, so `POST /sms-messages/{id}/read` is looped once per unread reply.
 * - `'none'` — an active session's thread. Expandable and readable, but never
 *   marks anything read: those replies remain the team leader's, the same
 *   exclusion `SmsInboxTabs`'s own badge count and `attention-summary` make.
 *
 * Collapsed, the summary line is the only thing shown — a household name or,
 * for an unknown thread, the phone number, the message count, and the unread
 * count in words as well as weight, the same way `SmsConversation`'s own
 * summary does. The thread and the footer render only once opened, matching
 * `SmsConversation` rather than the flat card this replaces, which showed
 * everything at once.
 */
function SmsInboxThread({
  group,
  markReadMode,
}: {
  group: SmsPhoneGroup;
  markReadMode: 'referral' | 'message' | 'none';
}) {
  const [open, setOpen] = useState(false);
  const markReferralRead = useMarkSmsRead();
  const markMessageRead = useMarkSmsInboxMessageRead();
  const searchMemory = useReferralSearchMemory();
  // A shared mutation hook loses track of any call but the last once a
  // second `.mutate()` re-points its observer — so a thread whose unread
  // replies span more than one referralId/message id tracks its own
  // read-marking outcome here instead of trusting `markReferralRead.error`/
  // `markMessageRead.error`, which would silently drop an earlier failure
  // the moment a later call in the same loop succeeds.
  const [readError, setReadError] = useState<unknown>();
  const unreadCount = group.unreadReplyIds.length;
  const primaryReferralId = group.referralIds[0];
  const mostRecentSessionMessage = group.messages.findLast(hasSession);
  const isReferrerThread = group.messages.every((message) => message.kind === 'referrer_reply');

  return (
    <li className={classNames(styles.messageCard, unreadCount > 0 && styles.unreadMessageCard)}>
      <details
        onToggle={(event) => {
          const expanded = event.currentTarget.open;
          setOpen(expanded);
          if (!expanded || unreadCount === 0) return;
          setReadError(undefined);
          if (markReadMode === 'referral') {
            void Promise.allSettled(
              group.referralIds.map((referralId) => markReferralRead.mutateAsync(referralId)),
            ).then((results) => {
              const failure = results.find((result) => result.status === 'rejected');
              if (failure?.status === 'rejected') setReadError(failure.reason);
            });
          } else if (markReadMode === 'message') {
            void Promise.allSettled(
              group.unreadReplyIds.map((id) => markMessageRead.mutateAsync(id)),
            ).then((results) => {
              const failure = results.find((result) => result.status === 'rejected');
              if (failure?.status === 'rejected') setReadError(failure.reason);
            });
          }
        }}
      >
        <summary className={unreadCount > 0 ? styles.unreadButton : undefined}>
          {isReferrerThread ? (
            <span>Referrer: {group.phone ?? 'No phone number'}</span>
          ) : primaryReferralId !== undefined ? (
            <SmsMessageHousehold referralId={primaryReferralId} />
          ) : (
            <span>Phone: {group.phone ?? 'No phone number'}</span>
          )}
          : {group.messages.length} {group.messages.length === 1 ? 'message' : 'messages'}
          {unreadCount > 0 && (
            <>
              {`, ${String(unreadCount)} unread `}
              <span className={styles.unreadFlag}>Unread</span>
            </>
          )}
          {group.hasFailure && unreadCount === 0 && (
            <span className={styles.needsAttention}> A reminder failed to send.</span>
          )}
        </summary>
        {open && (
          <>
            <SmsThreadMessages messages={group.messages} />
            <div className={styles.messageFooter}>
              {isReferrerThread ? (
                group.messages.map((message) => (
                  <ReferrerCandidateParcels key={message.id} message={message} />
                ))
              ) : primaryReferralId === undefined ? (
                <span>
                  Phone: {group.phone ?? 'No phone number'}{' '}
                  {group.phone !== null && (
                    <Link
                      onClick={() => {
                        // A phone number is personal data: the search screen
                        // reads this from its in-memory cache, never the URL
                        // or history.
                        if (group.phone === null) return;
                        searchMemory.remember({ phone: group.phone });
                      }}
                      to="/referrals/search"
                    >
                      Search referrals for this number
                    </Link>
                  )}
                </span>
              ) : (
                <>
                  {mostRecentSessionMessage !== undefined && (
                    <span>
                      {mostRecentSessionMessage.location === 'active_session'
                        ? 'Active session'
                        : 'Closed session'}
                      : {formatSessionDate(mostRecentSessionMessage.session.sessionDate)} at{' '}
                      {mostRecentSessionMessage.session.startTime}
                    </span>
                  )}
                  {group.referralIds.map((referralId) => (
                    <Link key={referralId} to={`/referrals/${referralId}`}>
                      Open referral
                    </Link>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </details>
      {readError !== undefined && <ErrorNotice error={readError} />}
    </li>
  );
}

function ReferrerCandidateParcels({ message }: { message: SmsInboxMessage }) {
  if (message.kind !== 'referrer_reply') return null;
  const candidates = message.candidateParcels ?? [];
  if (candidates.length === 0) {
    return <span>No open parcels for this referrer now.</span>;
  }
  return (
    <span>
      Possible open parcels:{' '}
      {candidates.map((parcel, index) => (
        <ReferrerCandidateParcelLink
          key={parcel.referralId}
          parcel={parcel}
          separator={index === 0 ? '' : ', '}
        />
      ))}
    </span>
  );
}

function ReferrerCandidateParcelLink({
  parcel,
  separator,
}: {
  parcel: SmsCandidateParcel;
  separator: string;
}) {
  return (
    <>
      {separator}
      <Link to={`/referrals/${parcel.referralId}`}>
        {formatSessionDate(parcel.sessionDate)} at {parcel.startTime}
      </Link>
    </>
  );
}

/**
 * The household's name for a message tied to a referral. `SmsInboxMessage`
 * deliberately carries no name of its own (`API.md`, "The administrator
 * inbox") — `referralId` is the only thing pointing at whose household this
 * is. Settled by Pete on 2026-08-30: a session message was assigned to a
 * referral, so it should read as that household's, not as a block of text
 * with only an "Open referral" link to say whose it was.
 *
 * A second request per referral rather than a name on the message itself,
 * which is fine here: `useReferral` shares one cache entry per id, so a
 * household with several messages in the window costs one request, not one
 * per row, and this screen is administrator-only already — nothing here
 * reaches a role that could not open the referral directly.
 */
function SmsMessageHousehold({ referralId }: { referralId: string }) {
  const referral = useReferral(referralId);
  // Loading/error text, not an empty span or `ErrorNotice`: this sits inside
  // a `<summary>`, a native disclosure control. `<summary>` only takes
  // phrasing content, and a nested `<button>` (which `ErrorNotice`'s retry
  // renders) is both invalid there and a real functional bug — a click on it
  // also toggles the accordion, so "Try again" can close the very thread it
  // was meant to fix. An empty accessible name while pending is its own
  // problem: a screen reader announces the row as "` : 3 messages`" with
  // nothing to say whose it is until the fetch resolves.
  if (referral.isPending) return <span className={styles.householdName}>Loading…</span>;
  if (referral.isError) return <span className={styles.householdName}>Name unavailable</span>;
  const name = [referral.data.refereeFirstName ?? 'Unknown', referral.data.refereeSurname ?? '']
    .join(' ')
    .trim();
  return <span className={styles.householdName}>{name}</span>;
}
