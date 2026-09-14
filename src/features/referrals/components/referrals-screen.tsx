import { Link, useLocation, useSearchParams } from 'react-router';
import type { RefObject } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { FeatureHero } from '../../../components/feature-hero';
import { UsersIcon } from '../../../components/icons';
import { Spinner } from '../../../components/spinner';
import { formatLondonDateTime, formatSessionDate } from '../../../lib/london-time';
import { listPathFor, listReturnContext, useReturnedListItem } from '../../../lib/list-return';
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
  const location = useLocation();

  const sessionId = searchParams.get(SESSION_PARAM) ?? '';
  const statusParam = searchParams.get(STATUS_PARAM);
  const status = isReferralStatus(statusParam) ? statusParam : undefined;

  const filters = {
    ...(sessionId === '' ? {} : { sessionId }),
    ...(status === undefined ? {} : { status }),
  };
  const referrals = useReferrals(filters);
  const [returnedReferralId, returnedReferralRef] = useReturnedListItem<HTMLAnchorElement>(
    referrals.isSuccess && !referrals.isFetching,
  );
  // Only used to label rows and filter options with a date rather than a bare
  // id. Its own failure is not this screen's failure — see `sessionLabel`.
  const sessions = useSessions();

  /**
   * This is deliberately a fresh query string rather than an edit of the one
   * the browser arrived with. The list's contract has exactly two URL filters:
   * a session id and a status enum; copying arbitrary query text forward would
   * make that privacy boundary drift without anybody noticing.
   */
  const setFilter = (filter: 'session' | 'status', value: string): void => {
    const next = new URLSearchParams();
    const nextSessionId = filter === 'session' ? value : sessionId;
    const nextStatus = filter === 'status' ? value : (status ?? '');
    if (nextSessionId !== '') next.set(SESSION_PARAM, nextSessionId);
    if (nextStatus !== '') next.set(STATUS_PARAM, nextStatus);
    setSearchParams(next, { replace: true });
  };

  const sessionLabel = (id: string): string => {
    const session = sessions.data?.find((candidate) => candidate.id === id);
    return session === undefined
      ? 'Session'
      : `${formatSessionDate(session.sessionDate)}, ${session.startTime}`;
  };

  return (
    <>
      <FeatureHero eyebrow="Referral management" icon={<UsersIcon />} title="Referrals">
        <p>
          See who has been referred, the session they are booked into, and their current status.
        </p>
      </FeatureHero>

      <section aria-labelledby="referral-filters-heading" className={styles.filtersPanel}>
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="referral-filters-heading">Filter referrals</h2>
            <p>Choose a session or status to narrow this list.</p>
          </div>
          {(sessionId !== '' || status !== undefined) && (
            <button
              className="button-secondary"
              onClick={() => {
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
              type="button"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className={styles.filters}>
          <label className={styles.filterField}>
            <span>Session</span>
            <select
              onChange={(event) => {
                setFilter('session', event.target.value);
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

          <label className={styles.filterField}>
            <span>Status</span>
            <select
              onChange={(event) => {
                setFilter('status', event.target.value);
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
      </section>

      {referrals.isPending && <Spinner label="Loading referrals…" />}

      {referrals.isError && (
        <ErrorNotice
          error={referrals.error}
          onRetry={() => {
            void referrals.refetch();
          }}
        />
      )}

      {referrals.isSuccess && (
        <section aria-labelledby="referral-results-heading" className={styles.resultsPanel}>
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="referral-results-heading">Referrals</h2>
              <p>
                {`${String(referrals.data.length)} ${referrals.data.length === 1 ? 'referral' : 'referrals'} found`}
              </p>
            </div>
          </div>
          {referrals.data.length === 0 ? (
            <EmptyState
              headline="No referrals to show"
              level="h3"
              sentence="Nothing matches this filter. Referrals arrive through the public referral form."
            />
          ) : (
            <div
              aria-label="Referrals"
              className={styles.tableFrame}
              role="region"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The horizontally scrollable table needs a keyboard focus target.
              tabIndex={0}
            >
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
                    <ReferralRow
                      key={referral.id}
                      referral={referral}
                      returnPath={listPathFor(location.pathname, location.search)}
                      returnedReferralId={returnedReferralId}
                      returnedReferralRef={returnedReferralRef}
                      sessions={sessions.data ?? []}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ReferralRow({
  referral,
  sessions,
  returnPath,
  returnedReferralId,
  returnedReferralRef,
}: {
  referral: Referral;
  sessions: readonly Session[];
  returnPath: string;
  returnedReferralId: string | null;
  returnedReferralRef: RefObject<HTMLAnchorElement | null>;
}) {
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
        <Link
          ref={referral.id === returnedReferralId ? returnedReferralRef : undefined}
          state={listReturnContext(returnPath, referral.id)}
          to={`/referrals/${referral.id}`}
        >
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
