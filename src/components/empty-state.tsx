import type { ReactNode } from 'react';
import styles from './empty-state.module.css';

/**
 * Nothing to show, said in a way somebody can act on.
 *
 * A headline, one sentence, and at most one action. The shape is deliberately
 * fixed: "no results" screens are where apps sprawl into paragraphs of apology,
 * and a volunteer mid-session reads none of it.
 */
export function EmptyState({
  headline,
  sentence,
  action,
}: {
  headline: string;
  sentence: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.headline}>{headline}</h2>
      <p className={styles.sentence}>{sentence}</p>
      {action !== undefined && <div>{action}</div>}
    </div>
  );
}
