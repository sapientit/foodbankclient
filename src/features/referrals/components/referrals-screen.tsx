import { Link, useSearchParams } from 'react-router';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatLondonDateTime, formatSessionDate } from '../../../lib/london-time';
import { useSessions, type Session } from '../../sessions/queries';
import { useReferrals, type Referral } from '../queries';
import {
  REFERRAL_STATUS_LABELS,
  REFERRAL_STATUS_OPTIONS,
  describeHousehold,
  isReferralStatus,
  isPurged,
  refereeNameForList,
  sortForReview,
} from '../referrals.logic';
import styles from './referrals-screen.module.css';

const SESSION_PARAM = 'sessionId';
const STATUS_PARAM = 'status';

/**
 * The referral list, filterable by session and by status — both roles can
 * open it (`API.md` §2: "Read sessions, stock, referrals, model parcels").
 * Nothing sensitive is on this screen at all: no reason, no referrer contact
 * detail, just who is coming, to which session, and whether they still are.
 * The detail screen is where the admin-only fields live, and only for an
 * admin — see `hasAdminFields` in `referrals.logic.ts`.
 *
 * **The session filter never touches the URL with anything but an id.**
 * `sessionId` and `status` are the two query-string keys this screen ever
 * writes, matching what `useReferrals` sends on to the server — no name, no
 * address, nothing personal ever becomes part of a link.
 */
export function ReferralsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();

  const sessionId = searchParams.get(SESSION_PARAM) ?? '';
  const statusParam = searchParams.get(STATUS_PARAM);
  const status = isReferralStatus(statusParam) ? statusParam : undefined;

  const filters = {
    ...(sessionId === '' ? {} : { sessionId }),
    ...(status === undefined ? {} : { status }),
  };
  const referrals = useReferrals(filters);
  // Only used to label rows and filter options with a date rather than a bare
  // id. Its own failure is not this screen's failure — see `sessionLabel`.
  const sessions = useSessions();

  const sessionLabel = (id: string): string => {
    const session = sessions.data?.find((candidate) => candidate.id === id);
    return session === undefined
      ? 'Session'
      : `${formatSessionDate(session.sessionDate)}, ${session.startTime}`;
  };

  return (
    <>
      <PageHeader title="Referrals" />

      <p className={styles.intro}>Who has been referred, to which session, and their status.</p>

      <div className={styles.filters}>
        <label>
          Session{' '}
          <select
            onChange={(event) => {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (event.target.value === '') next.delete(SESSION_PARAM);
                  else next.set(SESSION_PARAM, event.target.value);
                  return next;
                },
                { replace: true },
              );
            }}
            value={sessionId}
          >
            <option value="">All sessions</option>
            {(sessions.data ?? []).map((session) => (
              <option key={session.id} value={session.id}>
                {sessionLabel(session.id)} — {session.location}
              </option>
            ))}
          </select>
        </label>

        <label>
          Status{' '}
          <select
            onChange={(event) => {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (event.target.value === '') next.delete(STATUS_PARAM);
                  else next.set(STATUS_PARAM, event.target.value);
                  return next;
                },
                { replace: true },
              );
            }}
            value={status ?? ''}
          >
            <option value="">All</option>
            {REFERRAL_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {referrals.isPending && <Spinner label="Loading referrals…" />}

      {referrals.isError && (
        <ErrorNotice
          error={referrals.error}
          onRetry={() => {
            void referrals.refetch();
          }}
        />
      )}

      {referrals.isSuccess &&
        (referrals.data.length === 0 ? (
          <EmptyState
            headline="No referrals to show"
            sentence="Nothing matches this filter. Referrals arrive through the public referral form."
          />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Referee</th>
                <th scope="col">Household</th>
                <th scope="col">Organisation</th>
                <th scope="col">Session</th>
                <th scope="col">Referred</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortForReview(referrals.data).map((referral) => (
                <ReferralRow key={referral.id} referral={referral} sessions={sessions.data ?? []} />
              ))}
            </tbody>
          </table>
        ))}
    </>
  );
}

function ReferralRow({ referral, sessions }: { referral: Referral; sessions: readonly Session[] }) {
  const session = sessions.find((candidate) => candidate.id === referral.sessionId);
  const purged = isPurged(referral);

  return (
    <tr
      className={
        referral.status === 'pending_review'
          ? styles.pendingReview
          : referral.status === 'active'
            ? styles.activeReferral
            : undefined
      }
      data-active={referral.status === 'active' || undefined}
      data-pending-review={referral.status === 'pending_review' || undefined}
    >
      <th scope="row">
        <Link to={`/referrals/${referral.id}`}>
          {purged ? 'Details removed' : (refereeNameForList(referral) ?? '—')}
        </Link>
      </th>
      <td>{describeHousehold(referral)}</td>
      <td>{referral.referrerOrganisation}</td>
      <td>
        {session === undefined
          ? 'Session'
          : `${formatSessionDate(session.sessionDate)}, ${session.startTime}`}
      </td>
      <td>{formatLondonDateTime(referral.referredAt)}</td>
      <td>
        <span className={styles.status} data-status={referral.status}>
          {REFERRAL_STATUS_LABELS[referral.status]}
        </span>
        {referral.isDelivery && <span className={styles.deliveryTag}>Delivery</span>}
      </td>
    </tr>
  );
}
