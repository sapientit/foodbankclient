import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatLondonDateTime, formatSessionDate } from '../../../lib/london-time';
import type { Parcel, SmsInboxMessage } from '../queries';
import {
  useMarkSmsRead,
  useMarkSmsInboxMessageRead,
  useReplyBySms,
  useSendSmsReminders,
  useSmsSummary,
  useSmsThread,
  useSmsInbox,
} from '../queries';
import styles from './sms-panel.module.css';

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
  const send = useSendSmsReminders();
  const sending = useRef(false);
  const [result, setResult] = useState<{
    reminded: number;
    failed: number;
    alreadyReminded: number;
  }>();
  const countFor = (referralId: string) =>
    summary.data?.households.find((household) => household.referralId === referralId);

  return (
    <section aria-labelledby="sms-heading">
      <h2 id="sms-heading">Text messages</h2>
      {summary.isPending && <Spinner label="Loading message counts…" />}
      {summary.isError && (
        <ErrorNotice error={summary.error} onRetry={() => void summary.refetch()} />
      )}
      {summary.data !== undefined && (
        <p className={styles.unread} role="status">
          {summary.data.unreadTotal} unread{' '}
          {summary.data.unreadTotal === 1 ? 'message' : 'messages'}
        </p>
      )}
      {!readOnly && (
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
                onSettled: () => {
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
              {result.reminded} sent; {result.failed} failed; {result.alreadyReminded} already sent.
              {result.failed > 0 && <strong> Failed reminders need attention.</strong>}
            </p>
          )}
        </>
      )}
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
        {thread.data !== undefined && (
          <ol className={styles.thread}>
            {thread.data.messages.map((message) => (
              <li key={message.id}>
                <strong>{message.kind.replace('_', ' ')}</strong> — {message.body}{' '}
                <time dateTime={message.occurredAt}>
                  {formatLondonDateTime(message.occurredAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
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
                    onSuccess: () => {
                      setBody('');
                    },
                  },
                );
              }}
              type="button"
            >
              Send reply
            </button>
            {reply.isError && <ErrorNotice error={reply.error} />}
          </>
        )}
      </details>
    </li>
  );
}

export function SmsInboxScreen() {
  const inbox = useSmsInbox();
  return (
    <>
      <PageHeader title="SMS Messages" />
      <p>
        All text messages from the last thirty days. Unread replies from an unmatched or closed
        session need administrator attention; active-session replies remain with the team leader.
      </p>
      {inbox.isPending && <Spinner label="Loading SMS messages…" />}
      {inbox.isError && <ErrorNotice error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data !== undefined &&
        (inbox.data.messages.length === 0 ? (
          <p>No SMS messages in the last thirty days.</p>
        ) : (
          <>
            <SmsInboxGroup
              heading="Unmatched messages"
              messages={inbox.data.messages.filter((message) => message.location === 'unmatched')}
            />
            <SmsInboxGroup
              heading="Messages for active sessions"
              messages={inbox.data.messages.filter(
                (message) => message.location === 'active_session',
              )}
            />
            <SmsInboxGroup
              heading="Messages for closed sessions"
              messages={inbox.data.messages.filter(
                (message) => message.location === 'closed_session',
              )}
            />
          </>
        ))}
    </>
  );
}

function SmsInboxGroup({ heading, messages }: { heading: string; messages: SmsInboxMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <section aria-labelledby={`sms-${heading.replaceAll(' ', '-').toLowerCase()}`}>
      <h2 id={`sms-${heading.replaceAll(' ', '-').toLowerCase()}`}>{heading}</h2>
      <ul className={styles.thread}>
        {messages.map((message) => (
          <SmsInboxMessageRow key={message.id} message={message} />
        ))}
      </ul>
    </section>
  );
}

/** A read failure belongs to the one message it left unread, not every row. */
function SmsInboxMessageRow({ message }: { message: SmsInboxMessage }) {
  const markRead = useMarkSmsInboxMessageRead();
  const needsAttention =
    message.kind === 'household_reply' &&
    message.readAt === null &&
    message.location !== 'active_session';

  return (
    <li>
      <p>
        <strong>{message.kind.replace('_', ' ')}</strong> — {message.body}
      </p>
      <p>
        <time dateTime={message.occurredAt}>{formatLondonDateTime(message.occurredAt)}</time>
      </p>
      {message.location === 'unmatched' && <p>Phone: {message.phone ?? 'No phone number'}</p>}
      {message.session !== null && (
        <p>
          {message.location === 'active_session' ? 'Active session' : 'Closed session'}:{' '}
          {formatSessionDate(message.session.sessionDate)} at {message.session.startTime}
        </p>
      )}
      {message.referralId !== null && (
        <Link to={`/referrals/${message.referralId}`}>Open referral</Link>
      )}
      {needsAttention && <p className={styles.needsAttention}>Needs administrator attention.</p>}
      {needsAttention && (
        <button
          className="button-plain"
          disabled={markRead.isPending}
          onClick={() => {
            markRead.mutate(message.id);
          }}
          type="button"
        >
          Mark read
        </button>
      )}
      {markRead.isError && <ErrorNotice error={markRead.error} />}
    </li>
  );
}
