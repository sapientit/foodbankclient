import { useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { CapacityMeter } from '../../components/capacity-meter';
import { EmptyState } from '../../components/empty-state';
import { Pagination } from '../../components/pagination';
import { SessionListFilters } from '../../components/session-list-filters';
import { SessionTable } from '../../components/session-table';
import { Spinner } from '../../components/spinner';
import {
  addCalendarDays,
  endOfWeek,
  formatSessionDate,
  formatTimeRange,
  londonToday,
  startOfWeek,
} from '../../lib/london-time';
import { useSmsAttentionSummary } from '../pick-lists/queries';
import { useReferrals } from '../referrals/queries';
import { useSessions } from '../sessions/queries';
import { deliveryOccupancy } from '../sessions/sessions.logic';
import {
  DAYS_BACK,
  filterSessionsByStatus,
  readSessionListSelection,
} from '../sessions/session-list-filters.logic';
import { useLowStockSummary } from '../stock/queries';
import { previousWeeksNotCompleted } from './dashboard.logic';
import styles from './home-screen.module.css';

type SessionRangeTab = 'this-week' | 'next-week' | 'custom';

export function HomeScreen() {
  const { state } = useAuth();
  const [tab, setTab] = useState<SessionRangeTab>('this-week');
  const [page, setPage] = useState(1);
  const rangeTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [searchParams] = useSearchParams();
  const today = londonToday();
  const thisWeek = { from: startOfWeek(today), to: endOfWeek(today) };
  const nextWeek = { from: addCalendarDays(thisWeek.to, 1), to: addCalendarDays(thisWeek.to, 7) };
  const custom = readSessionListSelection(searchParams, today);
  const range = tab === 'this-week' ? thisWeek : tab === 'next-week' ? nextWeek : custom;

  const isSignedIn = state.status === 'signed-in';
  const isAdmin = isSignedIn && state.user.role === 'admin';
  const rangeTabs: readonly { readonly id: SessionRangeTab; readonly label: string }[] = isAdmin
    ? [
        { id: 'this-week', label: 'This week' },
        { id: 'next-week', label: 'Next week' },
        { id: 'custom', label: 'Custom range' },
      ]
    : [
        { id: 'this-week', label: 'This week' },
        { id: 'next-week', label: 'Next week' },
      ];
  const todaySessions = useSessions({ from: today, to: today });
  const sessions = useSessions({ from: range.from, to: range.to });
  /*
   * The lookback bound here is the same open guess `DAYS_BACK` already is on
   * the Manage Sessions / Run a session lists — see `OPEN-QUESTIONS.md`, Q38.
   * This is a second call site for that same unanswered horizon, not a new
   * question of its own.
   */
  const previous = useSessions({
    from: addCalendarDays(today, -DAYS_BACK),
    to: addCalendarDays(thisWeek.from, -1),
  });
  const pending = useReferrals({ status: 'pending_review' }, isAdmin);
  const active = useReferrals({ status: 'active' }, isAdmin);
  const lowStock = useLowStockSummary(isAdmin);
  const sms = useSmsAttentionSummary(isAdmin);
  const referralsWaiting = (pending.data?.length ?? 0) + (active.data?.length ?? 0);
  /*
   * A disabled query (a team lead's browser never issues these) stays
   * `isPending` forever, so gating on it unconditionally would spin the
   * Alerts section for a role that never sees these counts at all — only
   * count it as "still loading" when it was actually asked for.
   */
  const referralsCountPending = isAdmin && (pending.isPending || active.isPending);
  const alertsPending =
    referralsCountPending ||
    (isAdmin && lowStock.isPending) ||
    (isAdmin && sms.isPending) ||
    previous.isPending;
  const oldSessions = previousWeeksNotCompleted(previous.data ?? [], thisWeek.from);
  const shown =
    tab === 'custom'
      ? filterSessionsByStatus(sessions.data ?? [], custom.showCompleted)
      : (sessions.data ?? []);
  const pageCount = Math.max(1, Math.ceil(shown.length / 10));
  const displayed = shown.slice((page - 1) * 10, page * 10);
  const lowStockCount = lowStock.data?.lowStockCount ?? 0;
  const unreadTotal = sms.data?.unreadTotal ?? 0;
  const nothingNeedsAttention =
    lowStockCount + referralsWaiting + oldSessions.length + unreadTotal === 0;

  /*
   * A page kept from a wider or differently-filtered range can point past the
   * end of a narrower one. Custom range's date fields change `range` without
   * a tab click, so the reset can't live only in the tab buttons' `onClick`.
   * Adjusted during render rather than in an effect — the React-recommended
   * way to reset state when a prop-like value changes, since it lands before
   * the browser paints the stale page instead of after an extra render.
   */
  const rangeKey = `${range.from}|${range.to}`;
  const [pagedRangeKey, setPagedRangeKey] = useState(rangeKey);
  if (rangeKey !== pagedRangeKey) {
    setPagedRangeKey(rangeKey);
    setPage(1);
  }

  if (!isSignedIn) return null;
  if (state.user.role === 'fuel_admin') return <Navigate replace to="/fuel-help" />;

  const selectRangeTab = (index: number) => {
    const next = rangeTabs[index];
    if (next === undefined) return;
    setTab(next.id);
    rangeTabRefs.current[index]?.focus();
  };

  return (
    <div aria-label="Dashboard" className={styles.dashboard}>
      <div className={styles.dashboardMain}>
        <section aria-labelledby="todays-sessions" className={styles.overview}>
          {isAdmin && (
            <article className={styles.tile} data-category="referrals">
              <h2>Referrals</h2>
              {referralsCountPending ? (
                <Spinner label="Loading referral count…" />
              ) : (
                <>
                  <strong>{referralsWaiting}</strong>
                  <p>waiting for review</p>
                </>
              )}
              <Link to="/referrals">Check referrals</Link>
            </article>
          )}
          <section className={styles.todaySessions}>
            <h2 id="todays-sessions">Today's sessions</h2>
            {todaySessions.isPending ? (
              <Spinner label="Loading today's sessions…" />
            ) : (todaySessions.data?.length ?? 0) === 0 ? (
              <article className={styles.tile} data-category="sessions">
                <p>No sessions today.</p>
              </article>
            ) : (
              <ul className={styles.todayList}>
                {todaySessions.data?.map((session) => {
                  const delivery = deliveryOccupancy(session);
                  const time = formatTimeRange(session.startTime, session.durationMinutes);
                  return (
                    <li key={session.id}>
                      <article className={styles.tile} data-category="sessions">
                        <h3>{time}</h3>
                        <CapacityMeter capacity={session.capacity} noun="" value={session.booked} />
                        {session.deliveryCapacity === 0 ? (
                          <p>Collection Only</p>
                        ) : (
                          <CapacityMeter
                            capacity={delivery.deliveryCapacity}
                            noun=""
                            value={delivery.deliveryBooked}
                          />
                        )}
                        <Link
                          aria-label={`Run session, ${time}`}
                          to={`/run-sessions/${session.id}`}
                        >
                          Run session
                        </Link>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </section>
        <section aria-labelledby="upcoming-sessions" className={styles.upcomingPanel}>
          <h2 id="upcoming-sessions">Upcoming sessions</h2>
          <div aria-labelledby="upcoming-sessions" className={styles.tabs} role="tablist">
            {rangeTabs.map((rangeTab, index) => (
              <button
                aria-controls={`upcoming-sessions-panel-${rangeTab.id}`}
                aria-selected={tab === rangeTab.id}
                className="button-plain"
                id={`session-range-${rangeTab.id}`}
                key={rangeTab.id}
                onClick={() => {
                  setTab(rangeTab.id);
                }}
                onKeyDown={(event) => {
                  const currentIndex = rangeTabs.findIndex((candidate) => candidate.id === tab);
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    selectRangeTab((currentIndex + 1) % rangeTabs.length);
                  }
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    selectRangeTab((currentIndex - 1 + rangeTabs.length) % rangeTabs.length);
                  }
                  if (event.key === 'Home') {
                    event.preventDefault();
                    selectRangeTab(0);
                  }
                  if (event.key === 'End') {
                    event.preventDefault();
                    selectRangeTab(rangeTabs.length - 1);
                  }
                }}
                ref={(element) => {
                  rangeTabRefs.current[index] = element;
                }}
                role="tab"
                tabIndex={tab === rangeTab.id ? 0 : -1}
                type="button"
              >
                {rangeTab.label}
              </button>
            ))}
          </div>
          {rangeTabs.map((rangeTab) => (
            <div
              aria-labelledby={`session-range-${rangeTab.id}`}
              hidden={tab !== rangeTab.id}
              id={`upcoming-sessions-panel-${rangeTab.id}`}
              key={rangeTab.id}
              role="tabpanel"
              tabIndex={0}
            >
              {tab === rangeTab.id && (
                <>
                  {tab === 'custom' && <SessionListFilters />}
                  {sessions.isPending ? (
                    <Spinner label="Loading sessions…" />
                  ) : displayed.length === 0 ? (
                    <EmptyState
                      headline="No upcoming sessions"
                      level="h3"
                      sentence={
                        !isAdmin && tab === 'next-week' && nextWeek.to > addCalendarDays(today, 6)
                          ? "Sessions further ahead than six days aren't listed for a team lead."
                          : 'No sessions fall in this range.'
                      }
                    />
                  ) : (
                    <>
                      <SessionTable
                        action={(session) => {
                          // Matches `SessionTable`'s own row link: two sessions on one
                          // day are common enough that a name built from the date alone
                          // announces identically for both — see that component's
                          // comment on `aria-label`.
                          const when = formatSessionDate(session.sessionDate);
                          const hours = formatTimeRange(session.startTime, session.durationMinutes);
                          return (
                            <span className={styles.rowActions}>
                              <Link
                                aria-label={`Run session, ${when}, ${hours}`}
                                className={styles.rowAction}
                                to={`/run-sessions/${session.id}`}
                              >
                                ▶
                              </Link>
                              {isAdmin && (
                                <Link
                                  aria-label={`Amend session, ${when}, ${hours}`}
                                  className={styles.rowAction}
                                  to={`/sessions/${session.id}`}
                                >
                                  ✎
                                </Link>
                              )}
                            </span>
                          );
                        }}
                        caption={`Sessions ${tab === 'this-week' ? 'this week' : tab === 'next-week' ? 'next week' : 'in the selected range'}`}
                        captionHidden
                        capacityNouns={false}
                        hrefFor={(session) => `/sessions/${session.id}`}
                        sessions={displayed}
                      />
                      <Pagination
                        onPageChange={setPage}
                        page={Math.min(page, pageCount)}
                        pageCount={pageCount}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </section>
      </div>
      <aside aria-labelledby="alerts-heading" className={styles.alertsPanel}>
        <h2 id="alerts-heading">Alerts</h2>
        {alertsPending ? (
          <Spinner label="Loading alerts…" />
        ) : (
          <div className={styles.alerts}>
            {isAdmin && lowStockCount > 0 && (
              <Alert
                category="stock"
                headline={`${String(lowStockCount)} stock items with low stock`}
                to="/stock"
              />
            )}
            {isAdmin && referralsWaiting > 0 && (
              <Alert
                category="referrals"
                headline={`${String(referralsWaiting)} referrals waiting for review`}
                to="/referrals"
              />
            )}
            {oldSessions.length > 0 && (
              // Same Q38-guessed lookback as the `previous` query above —
              // marked again here because this is the second place in this
              // file the guess is used, not because it is a second guess.
              <Alert
                category="sessions"
                headline={`${String(oldSessions.length)} sessions from previous weeks not completed`}
                to={`/sessions?from=${addCalendarDays(today, -DAYS_BACK)}&to=${addCalendarDays(thisWeek.from, -1)}`}
              />
            )}
            {isAdmin && unreadTotal > 0 && (
              <Alert
                category="referrals"
                headline={`${String(unreadTotal)} unread SMS messages`}
                to="/sms"
              />
            )}
            {nothingNeedsAttention && (
              <EmptyState
                headline="Nothing needs attention"
                level="h3"
                sentence="Nothing needs attention right now."
              />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Alert({
  category,
  headline,
  to,
}: {
  readonly category: 'sessions' | 'referrals' | 'stock';
  readonly headline: string;
  readonly to: string;
}) {
  return (
    <article className={styles.alert} data-category={category}>
      <Link className={styles.alertLink} to={to}>
        <h3>{headline}</h3>
      </Link>
    </article>
  );
}
