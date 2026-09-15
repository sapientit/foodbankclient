import type { ReactNode } from 'react';
import styles from './page-header.module.css';

/**
 * The `<h1>` of a screen, with room for the one action that screen is about.
 *
 * Every routed screen uses it, so a volunteer landing anywhere finds the title
 * in the same place and a screen reader announces one heading at level one.
 */
export function PageHeader({
  title,
  action,
  description,
  icon,
}: {
  title: string;
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        {icon !== undefined && <span className={styles.icon}>{icon}</span>}
        <div>
          <h1 className={styles.title}>{title}</h1>
          {description !== undefined && <div className={styles.description}>{description}</div>}
        </div>
      </div>
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </header>
  );
}
