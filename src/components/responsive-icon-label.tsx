import { type ReactNode } from 'react';
import styles from './responsive-icon-label.module.css';

/**
 * Gives compact row actions a consistently large icon and adds the short
 * visible action name only when there is room for it on a wide desktop.
 * The parent control still owns its full accessible name, including the item.
 */
export function ResponsiveIconLabel({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <span className={styles.action}>
      {children}
      <span className={styles.label}>{label}</span>
    </span>
  );
}
