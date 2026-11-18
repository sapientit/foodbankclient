import { Link, useLocation, useSearchParams } from 'react-router';
import type { RefObject } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { ChevronRightIcon, ClipboardCheckIcon } from '../../../components/icons';
import { PageHeader } from '../../../components/page-header';
import { Pagination } from '../../../components/pagination';
import { Spinner } from '../../../components/spinner';
import { formatLondonDateTime, formatSessionDate } from '../../../lib/london-time';
import { listPathFor, listReturnContext, useReturnedListItem } from '../../../lib/list-return';
import { useSessions, type Session } from '../../sessions/queries';
import { useReferralsForCheck, type Referral } from '../queries';
import {
  REFERRAL_STATUS_LABELS,
  REFERRAL_STATUS_OPTIONS,
  describeHousehold,
  isReferralStatus,
  refereeNameForList,
} from '../referrals.logic';
import styles from './referrals-screen.module.css';

const SESSION_PARAM = 'sessionId';
const STATUS_PARAM = 'status';
const PAGE_PARAM = 'page';

/**
 * The referral list, filterable by session and by status — both roles can
 * open it (`API.md` §2: "Read sessions, stock, referrals, model parcels").
 * Nothing sensitive is on this screen at all: no reason, no referrer contact
 * detail, just who is coming, to which session, and whether they still are.
 * The detail screen is where the admin-only fields live, and only for an
 * admin — see `hasAdminFields` in `referrals.logic.ts`.
 *
 * **The session filter never touches the URL with anything but an id.**
 * `sessionId`, `status` and `page` are the only query-string keys this
 * screen ever writes, matching what `useReferralsForCheck` sends on to the
 * server — no name, no address, nothing personal ever becomes part of a
 * link.
 *
 * **This screen does not sort, filter or paginate on the client.**
 * `GET /referrals/check` already returns the attention-first, thirty-day-
 * bounded, forty-at-a-time answer — see `useReferralsForCheck`'s own
 * comment. Rendering anything other than exactly what it returns, in the
 * order it returns it, would either duplicate that rule or drift from it.
 */
export function ReferralsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const sessionId = searchParams.get(SESSION_PARAM) ?? '';
  const statusParam = searchParams.get(STATUS_PARAM);
  const status = isReferralStatus(statusParam) ? statusParam : undefined;
  const pageParam = Number.parseInt(searchParams.get(PAGE_PARAM) ?? '', 10);
  const requestedPage = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;

  const filters = {
    ...(sessionId === '' ? {} : { sessionId }),
    ...(status === undefined ? {} : { status }),
    ...(requestedPage <= 1 ? {} : { page: requestedPage }),
  };
  const referrals = useReferralsForCheck(filters);
  const [returnedReferralId, returnedReferralRef] = useReturnedListItem<HTMLAnchorElement>(
    referrals.isSuccess && !referrals.isFetching,
  );
  // Only used to label rows and filter options with a date rather than a bare
  // id. Its own failure is not this screen's failure — see `sessionLabel`.
  const sessions = useSessions();

  const totalCount = referrals.data?.totalCount ?? 0;
  const pageSize = referrals.data?.pageSize ?? 40;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  // Guards only the *displayed* page number and what Previous/Next compute
  // from — a page past the end is still requested as typed, so an invalid
  // URL shows the honest empty state rather than silently rewriting itself.
  const currentPage = Math.min(requestedPage, pageCount);

  /**
   * This is deliberately a fresh query string rather than an edit of the one
   * the browser arrived with. The list's contract has exactly three URL
   * filters: a session id, a status enum and a page number; copying
   * arbitrary query text forward would make that privacy boundary drift
   * without anybody noticing. Changing the session or the status drops
   * whatever page was showing — a page number from a wider or differently
   * filtered result does not carry over to a narrower one.
   */
  const setFilter = (filter: 'session' | 'status', value: string): void => {
    const next = new URLSearchParams();
    const nextSessionId = filter === 'session' ? value : sessionId;
    const nextStatus = filter === 'status' ? value : (status ?? '');
    if (nextSessionId !== '') next.set(SESSION_PARAM, nextSessionId);
    if (nextStatus !== '') next.set(STATUS_PARAM, nextStatus);
    setSearchParams(next, { replace: true });
  };

  const setPage = (nextPage: number): void => {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete(PAGE_PARAM);
    else next.set(PAGE_PARAM, String(nextPage));
    setSearchParams(next, { replace: true });
  };

  const sessionLabel = (id: string): string => {
    const session = sessions.data?.find((candidate) => candidate.id === id);
    return session === undefined
      ? 'Session'
      : `${formatSessionDate(session.sessionDate)}, ${session.startTime}`;
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader
          description={
            <p>
              See who has been referred, the session they are booked into, and their current status.
            </p>
          }
          icon={<ClipboardCheckIcon />}
          title="Check referrals"
        />
      </div>

      <section aria-label="Filter referrals" className={styles.filtersPanel}>
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
                  {sessionLabel(session.id)}
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
              {/* Announced together: a filter or page change can replace this
                  count without the table remounting, which a sighted user
                  sees but a screen-reader user otherwise would not hear. */}
              <div aria-live="polite" role="status">
                <p>
                  {`${String(totalCount)} ${totalCount === 1 ? 'referral' : 'referrals'} found`}
                </p>
                {/* `useReferralsForCheck` keeps the previous page's rows on
                    screen while a new one loads (`placeholderData:
                    keepPreviousData`, `queries.ts`) so a filter or page
                    change cannot drop focus. This is what tells anyone —
                    sighted or not — that what they are looking at is about
                    to change. */}
                {referrals.isFetching && <p className={styles.fetchingNote}>Updating…</p>}
              </div>
            </div>
          </div>
          {referrals.data.referrals.length === 0 ? (
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
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.data.referrals.map((referral) => (
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
          {/* Not gated on there being rows this page: a page number past the
              end (a stale link, a hand-edited URL) must still offer a way
              back to a page that has some, not just an empty table with no
              way out. `Pagination` itself renders nothing when there is
              only one page. */}
          <Pagination onPageChange={setPage} page={currentPage} pageCount={pageCount} />
        </section>
      )}
    </div>
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
  const displayName = refereeNameForList(referral) ?? '—';

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
          {displayName}
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
      <td className={styles.action}>
        <Link
          aria-label={`View ${displayName}`}
          className="button-link button-plain"
          state={listReturnContext(returnPath, referral.id)}
          to={`/referrals/${referral.id}`}
        >
          <ChevronRightIcon />
        </Link>
      </td>
    </tr>
  );
}
