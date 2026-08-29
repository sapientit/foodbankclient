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
  level = 'h2',
}: {
  headline: string;
  sentence: string;
  action?: ReactNode;
  /** The screen this sits in already has its own heading — `h2` fits a
   * top-level empty screen, `h3` fits one nested inside a section that
   * already carries an `h2` of its own. Defaults to `h2` for every existing
   * caller. */
  level?: 'h2' | 'h3';
}) {
  const Heading = level;
  return (
    <div className={styles.empty}>
      <Heading className={styles.headline}>{headline}</Heading>
      <p className={styles.sentence}>{sentence}</p>
      {action !== undefined && <div>{action}</div>}
    </div>
  );
}
