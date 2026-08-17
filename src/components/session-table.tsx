import { Link } from 'react-router';
import { formatSessionDate, formatTimeRange } from '../lib/london-time';
import { collectionOnlyLabel } from '../lib/session-description';
import {
  SESSION_STATUS_LABELS,
  describeOccupancy,
  occupancy,
} from '../features/sessions/sessions.logic';
import type { SessionStatus } from '../features/sessions/keys';
import styles from './session-table.module.css';

/**
 * A list of sessions, as five aligned columns: the date, the hours,
 * `Collection Only` or nothing, how many households are booked, and the status.
 *
 * **One table for both lists.** `Run a session` and `Manage Sessions` show the
 * same five facts about the same rows and differ only in what a row links to
 * and what sits above it, so a volunteer covering both reads one layout rather
 * than two. It is a real `<table>` rather than the CSS grid this replaced
 * because the columns now carry headings a screen reader can announce per cell,
 * which a grid of `<span>`s cannot.
 *
 * Presentational: no fetching, no filtering, no query hook. It is given rows and
 * a way to link one.
 *
 * The type is structural rather than the generated `Session` — the same
 * reasoning as `src/lib/session-description.ts` — which keeps the dependency
 * arrow pointing inwards and this component testable without a fixture.
 */
export interface TabulatedSession {
  readonly id: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly durationMinutes: number;
  readonly deliveriesAllowed: boolean;
  readonly booked: number;
  readonly capacity: number;
  readonly status: SessionStatus;
}

export function SessionTable({
  caption,
  hrefFor,
  sessions,
}: {
  /** Names the table for anyone who cannot see which screen it is on. */
  readonly caption: string;
  readonly hrefFor: (session: TabulatedSession) => string;
  readonly sessions: readonly TabulatedSession[];
}) {
  return (
    /*
     * Focusable, because a table that scrolls sideways on a phone is unreachable
     * by keyboard otherwise. The same wrapper the referral search uses.
     */
    <div
      className={styles.tableWrap}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table needs a keyboard focus target.
      tabIndex={0}
    >
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Time</th>
            <th scope="col">Collection Only</th>
            <th scope="col">Bookings</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <SessionTableRow href={hrefFor(session)} key={session.id} session={session} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionTableRow({
  href,
  session,
}: {
  readonly href: string;
  readonly session: TabulatedSession;
}) {
  const stats = occupancy(session);
  const when = formatSessionDate(session.sessionDate);
  const hours = formatTimeRange(session.startTime, session.durationMinutes);

  return (
    <tr>
      {/* The date heads the row and carries the link: it is what somebody is
          looking for when they scan this list, and it is the one cell that is
          never empty.

          **Named by date and hours together, though only the date is drawn.**
          A sighted reader gets the hours from the next column along; somebody
          moving between links never sees that column, and the food bank runs
          two sessions on one day often enough that a list of identical
          "Tue, 4 Aug 2026" links is a way to open the wrong one — which on this
          screen is where attendance is recorded. Same reasoning as the
          Attended/No show buttons in `run-sessions-screen.tsx`, which spell out
          the household for exactly this reason. */}
      <th scope="row">
        <Link aria-label={`${when}, ${hours}`} className={styles.rowLink} to={href}>
          {when}
        </Link>
      </th>
      <td className={styles.time}>{hours}</td>
      {/* Where the hall's name used to be. One location, so it read the same on
          every row; whether a session takes deliveries does not. The cell stays
          empty for an ordinary session — see `src/lib/session-description.ts`. */}
      <td>{collectionOnlyLabel(session)}</td>
      <td className={styles.bookings}>
        {describeOccupancy(stats)}
        {/* Over capacity is a deliberate admin action, not a fault — see
            `sessions.logic.ts`. It is said plainly, not styled as an error. */}
        {stats.isOverCapacity && ' (over capacity)'}
      </td>
      <td>
        <span className={styles.status} data-status={session.status}>
          {SESSION_STATUS_LABELS[session.status]}
        </span>
      </td>
    </tr>
  );
}
