import { NavLink, Outlet } from 'react-router';
import { StockPrototypeProvider } from '../stock-prototype-store';
import styles from './stock-prototype-layout.module.css';

const TABS: readonly { to: string; label: string }[] = [
  { to: '/stock-prototype', label: 'About' },
  { to: '/stock-prototype/groupings', label: 'Groupings' },
  { to: '/stock-prototype/crates', label: 'Crates' },
  { to: '/stock-prototype/take', label: 'Stock take' },
  { to: '/stock-prototype/validation', label: 'Validation' },
  { to: '/stock-prototype/shopping', label: 'Targets and shopping' },
];

/**
 * One provider instance shared across every prototype screen, so moving between them (adding a
 * crate, then checking Validation) keeps what was just entered instead of resetting per screen —
 * and a nav strip to actually move between them, since these routes aren't in the real menu.
 */
export function StockPrototypeLayout() {
  return (
    <StockPrototypeProvider>
      <nav aria-label="Stock handling prototype" className={styles.tabs}>
        {TABS.map((tab) => (
          <NavLink
            className={({ isActive }) => (isActive ? styles.activeTab : styles.tab)}
            end={tab.to === '/stock-prototype'}
            key={tab.to}
            to={tab.to}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </StockPrototypeProvider>
  );
}
