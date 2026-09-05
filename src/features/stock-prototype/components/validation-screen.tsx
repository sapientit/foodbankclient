import { useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { PageHeader } from '../../../components/page-header';
import { formatLondonDateTime } from '../../../lib/london-time';
import { useStockPrototypeStore } from '../stock-prototype-store';
import { validateStock } from '../stock-prototype.logic';
import type { ValidationIssue } from '../types';
import styles from './validation-screen.module.css';

const CRATE_ISSUE_KINDS: readonly ValidationIssue['kind'][] = [
  'shelf-without-crate',
  'crate-too-few-members',
  'member-shelf-mismatch',
];

const COUNTING_ISSUE_KINDS: readonly ValidationIssue['kind'][] = [
  'item-uncounted',
  'item-double-counted',
];

/**
 * Validation, per planning doc §2: crate integrity and counting coverage. This is not a report to
 * review "when convenient" — a broken crate breaks the stock-take page and the shopping figures
 * until it is fixed, so the list below is always the current state, recomputed on every render.
 * Prototype only: reads from `useStockPrototypeStore`, nothing here calls the API.
 */
export function ValidationScreen() {
  const { state } = useStockPrototypeStore();
  const issues = validateStock(state);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  const crateIssues = issues.filter((issue) => CRATE_ISSUE_KINDS.includes(issue.kind));
  const countingIssues = issues.filter((issue) => COUNTING_ISSUE_KINDS.includes(issue.kind));

  return (
    <>
      <PageHeader
        title="Validation"
        action={
          <button
            className="button-secondary"
            onClick={() => {
              setCheckedAt(Date.now());
            }}
            type="button"
          >
            Re-check now
          </button>
        }
      />

      <p className={styles.intro}>
        This list reflects the state right now, and would re-run automatically after every
        stock-item edit — nothing here is a soft warning to leave for later, because a broken crate
        breaks the stock-take page and the shopping figures until it is fixed. A bulk-load of stock
        items would bypass that edit-triggered check entirely, which is exactly why this screen also
        exists as a standalone, independently runnable action.
      </p>

      {checkedAt !== null && (
        <p className={styles.checkedAt}>
          Checked just now, at {formatLondonDateTime(new Date(checkedAt).toISOString())}.
        </p>
      )}

      {issues.length === 0 ? (
        <EmptyState
          headline="No problems found"
          sentence="Every shelf, crate and item checks out."
        />
      ) : (
        <>
          {crateIssues.length > 0 && (
            <section>
              <h2>Crate problems</h2>
              <ul className={styles.issueList}>
                {crateIssues.map((issue, index) => (
                  <li className={styles.issue} key={index}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {countingIssues.length > 0 && (
            <section>
              <h2>Counting problems</h2>
              <ul className={styles.issueList}>
                {countingIssues.map((issue, index) => (
                  <li className={styles.issue} key={index}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
