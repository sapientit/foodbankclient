import { useRef, useState } from 'react';
import { ErrorNotice } from '../../../components/error-notice';
import { Spinner } from '../../../components/spinner';
import { formatLondonDateTime } from '../../../lib/london-time';
import type { Parcel } from '../queries';
import {
  useMarkSmsRead,
  useMarkUnmatchedSmsRead,
  useReplyBySms,
  useSendSmsReminders,
  useSmsSummary,
  useSmsThread,
  useUnmatchedSms,
} from '../queries';
import styles from './sms-panel.module.css';

export function SessionSmsPanel({ sessionId, parcels }: { sessionId: string; parcels: Parcel[] }) {
  const summary = useSmsSummary(sessionId);
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
      <button
        aria-disabled={send.isPending}
        onClick={() => {
          if (sending.current) return;
          sending.current = true;
          send.mutate(sessionId, {
            onSuccess: (response) => setResult(response),
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
      <ul className={styles.households}>
        {parcels.map((parcel) => {
          const count = countFor(parcel.referralId);
          return (
            <SmsConversation
              key={parcel.referralId}
              name={`${parcel.refereeFirstName ?? 'Unknown'} ${parcel.refereeSurname ?? ''}`.trim()}
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
  unreadCount,
  messageCount,
}: {
  referralId: string;
  name: string;
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
          if (expanded && unreadCount > 0) markRead.mutate(referralId);
        }}
      >
        <summary className={unreadCount > 0 ? styles.unreadButton : undefined}>
          {name}: {messageCount} {messageCount === 1 ? 'message' : 'messages'}
          {unreadCount > 0 && `, ${unreadCount} unread`}
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
        <label>
          Reply by SMS
          <textarea
            maxLength={480}
            onChange={(event) => setBody(event.target.value)}
            value={body}
          />
        </label>
        <p className={styles.warning}>
          Do not include the household’s name, address, or anything that identifies them.
        </p>
        <button
          disabled={body.trim() === '' || reply.isPending}
          onClick={() => {
            reply.mutate({ referralId, body: body.trim() }, { onSuccess: () => setBody('') });
          }}
          type="button"
        >
          Send reply
        </button>
        {reply.isError && <ErrorNotice error={reply.error} />}
      </details>
    </li>
  );
}

export function UnmatchedSmsScreen() {
  const messages = useUnmatchedSms();
  const markRead = useMarkUnmatchedSmsRead();
  if (messages.isPending) return <Spinner label="Loading unmatched messages…" />;
  if (messages.isError)
    return <ErrorNotice error={messages.error} onRetry={() => void messages.refetch()} />;
  return (
    <section aria-labelledby="unmatched-sms-heading">
      <h1 id="unmatched-sms-heading">Unmatched SMS replies</h1>
      {messages.data?.messages.length === 0 ? (
        <p>No unmatched replies.</p>
      ) : (
        <ul className={styles.thread}>
          {messages.data?.messages.map((message) => (
            <li key={message.id}>
              <p>
                <strong>{message.phone ?? 'No phone number'}</strong> — {message.body}
              </p>
              <p>
                <time dateTime={message.occurredAt}>
                  {formatLondonDateTime(message.occurredAt)}
                </time>
              </p>
              {message.readAt === null && (
                <button
                  disabled={markRead.isPending}
                  onClick={() => markRead.mutate(message.id)}
                  type="button"
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {markRead.isError && <ErrorNotice error={markRead.error} />}
    </section>
  );
}
