import type { ReactNode } from 'react';
import styles from './feature-hero.module.css';

/**
 * The short, category-coloured introduction used by an operational screen.
 *
 * It deliberately owns the page's one level-one heading: a screen gets a
 * useful introduction without creating a second heading beside a PageHeader.
 */
export function FeatureHero({
  eyebrow,
  title,
  children,
  icon,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className={styles.hero}>
      {eyebrow !== undefined && <p className={styles.eyebrow}>{eyebrow}</p>}
      <div className={styles.titleRow}>
        {icon !== undefined && <span className={styles.icon}>{icon}</span>}
        <h1 className={styles.title}>{title}</h1>
      </div>
      <div className={styles.summary}>{children}</div>
    </header>
  );
}
