import type { ReactNode } from 'react';
import styles from './page-header.module.css';

/**
 * The `<h1>` of a screen, with room for the one action that screen is about.
 *
 * Every routed screen uses it, so a volunteer landing anywhere finds the title
 * in the same place and a screen reader announces one heading at level one.
 */
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </header>
  );
}
