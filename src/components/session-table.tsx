import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { CapacityMeter } from './capacity-meter';
import { formatSessionDate, formatTimeRange } from '../lib/london-time';
import { deliveryLabel, standingFromCapacity } from '../lib/session-description';
import {
  SESSION_STATUS_LABELS,
  deliveryOccupancy,
  occupancy,
} from '../features/sessions/sessions.logic';
import type { SessionStatus } from '../features/sessions/keys';
import styles from './session-table.module.css';

/**
 * A list of sessions, as aligned columns: the date, the hours,
 * `Collection Only` or delivery occupancy, how many households are booked, and
 * the status. A supplied action adds a final control column.
 *
 * **Never `No deliveries` here, unlike the referrer's dropdown.** Staff need
 * the actual delivery count and capacity; the full or over-capacity state is
 * stated in words as well as shown by the capacity bar.
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
  readonly deliveryCapacity: number;
  readonly deliveryBooked: number;
  readonly booked: number;
  readonly capacity: number;
  readonly status: SessionStatus;
}

export function SessionTable({
  caption,
  hrefFor,
  sessions,
  action,
  captionHidden = false,
  capacityNouns = true,
}: {
  /** Names the table for anyone who cannot see which screen it is on. */
  readonly caption: string;
  /** Keep the table name for assistive technology when nearby context states it visually. */
  readonly captionHidden?: boolean;
  /** The dashboard's column headings already say what each capacity count measures. */
  readonly capacityNouns?: boolean;
  readonly hrefFor: (session: TabulatedSession) => string;
  readonly sessions: readonly TabulatedSession[];
  /** An optional per-row control, used by the dashboard without coupling it to this table. */
  readonly action?: (session: TabulatedSession) => ReactNode;
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
        <caption className={captionHidden ? styles.visuallyHidden : styles.caption}>
          {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Time</th>
            <th scope="col">Deliveries</th>
            <th scope="col">Bookings</th>
            <th scope="col">Status</th>
            {action !== undefined && <th scope="col">Action</th>}
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <SessionTableRow
              action={action}
              capacityNouns={capacityNouns}
              href={hrefFor(session)}
              key={session.id}
              session={session}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionTableRow({
  href,
  session,
  action,
  capacityNouns,
}: {
  readonly href: string;
  readonly session: TabulatedSession;
  readonly action: ((session: TabulatedSession) => ReactNode) | undefined;
  readonly capacityNouns: boolean;
}) {
  const stats = occupancy(session);
  const delivery = deliveryOccupancy(session);
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
      <td>
        {session.deliveryCapacity === 0 ? (
          deliveryLabel(standingFromCapacity(session.deliveryCapacity))
        ) : (
          <CapacityMeter
            capacity={delivery.deliveryCapacity}
            noun={capacityNouns ? 'deliveries' : ''}
            value={delivery.deliveryBooked}
          />
        )}
      </td>
      <td className={styles.bookings}>
        <CapacityMeter
          capacity={stats.capacity}
          noun={capacityNouns ? 'booked' : ''}
          value={stats.booked}
        />
      </td>
      <td>
        <span className={styles.status} data-status={session.status}>
          {SESSION_STATUS_LABELS[session.status]}
        </span>
      </td>
      {action !== undefined && <td className={styles.action}>{action(session)}</td>}
    </tr>
  );
}
