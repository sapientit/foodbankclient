import { useId } from 'react';
import { useSearchParams } from 'react-router';
import {
  FROM_PARAM,
  SHOW_COMPLETED_PARAM,
  TO_PARAM,
  readSessionListSelection,
} from '../features/sessions/session-list-filters.logic';
import { londonToday } from '../lib/london-time';
import styles from './session-list-filters.module.css';

/**
 * The controls above both session lists: a date window, and whether completed
 * sessions are included.
 *
 * **The URL is the state.** Both this and the screen around it read the
 * selection back out of the query string through the same pure function, so
 * there is one source of truth and no props to keep in step — and a team lead
 * can send somebody a link to the fortnight they are looking at. Dates are not
 * personal data, so this is a query string they may safely reach; ids and dates
 * are the only things any screen here writes into one.
 *
 * `{ replace: true }` because changing a filter is not a place to come back to
 * with the back button — the same idiom the referral list uses.
 */
export function SessionListFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = readSessionListSelection(searchParams, londonToday());
  const fromId = useId();
  const toId = useId();

  const set = (key: string, value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === '') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className={styles.filters}>
      {/* Grouped, because the two boxes are one range. Tabbing from `From` to
          `To` otherwise gives no sign they bound the same question rather than
          being two unrelated filters. */}
      <fieldset className={styles.range}>
        <legend className={styles.legend}>Date range</legend>
        <span className={styles.field}>
          <label htmlFor={fromId}>From</label>{' '}
          <input
            id={fromId}
            onChange={(event) => {
              set(FROM_PARAM, event.target.value);
            }}
            type="date"
            value={selection.from}
          />
        </span>
        <span className={styles.field}>
          <label htmlFor={toId}>To</label>{' '}
          <input
            id={toId}
            onChange={(event) => {
              set(TO_PARAM, event.target.value);
            }}
            type="date"
            value={selection.to}
          />
        </span>
      </fieldset>
      <p className={styles.field}>
        <label>
          <input
            checked={selection.showCompleted}
            onChange={(event) => {
              set(SHOW_COMPLETED_PARAM, event.target.checked ? 'true' : '');
            }}
            type="checkbox"
          />{' '}
          Show completed
        </label>
      </p>
    </div>
  );
}
