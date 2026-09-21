import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import foodbankLogo from '../assets/foodbank-logo.webp';
import { useAuth } from '../auth/auth-context';
import {
  categoryForPath,
  subtabsFor,
  topTabForPath,
  topTabsFor,
  type NavigationCategory,
} from '../auth/menu';
import { classNames } from '../lib/class-names';
import styles from './app-shell.module.css';
import { BoxIcon, CalendarIcon, FuelIcon, GridIcon, HomeIcon, UsersIcon } from './icons';

const CATEGORY_ICON: Record<NavigationCategory, typeof HomeIcon> = {
  sessions: CalendarIcon,
  referrals: UsersIcon,
  stock: BoxIcon,
  'master-data': GridIcon,
};

/**
 * The dashboard route falls under the `master-data` category for colouring
 * purposes (see `categoryForPath`), but reads better as a home glyph; fuel
 * help shares the `referrals` category for the same reason but is a fuel
 * admin's only tab, so it earns its own icon rather than borrowing theirs.
 */
function iconForTab(to: string) {
  if (to === '/') return HomeIcon;
  if (to === '/fuel-help') return FuelIcon;
  return CATEGORY_ICON[categoryForPath(to)];
}

/**
 * The frame every signed-in screen sits inside: the product name, the
 * role-appropriate nav, who is signed in, and a way out.
 *
 * It carries no guard of its own. The layout route wraps it in `RequireAuth`,
 * which is what keeps the unauthenticated routes — sign-in, and the public
 * referral flow — plain siblings rather than exceptions carved out of a shell
 * that wraps everything. See `routes.tsx`.
 *
 * Accessibility is load-bearing here rather than a finishing touch: this is the
 * one component every volunteer meets, often on a borrowed phone. Skip link,
 * `aria-current` on the active link, and a separate labelled subnavigation when
 * a primary area has more than one destination.
 */
export function AppShell() {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  /*
   * The shell only ever renders inside `RequireAuth`, which does not render its
   * children until the session is known. Narrowing rather than asserting keeps
   * that invariant in the type system instead of behind a `!`.
   */
  if (state.status !== 'signed-in') return null;

  const { displayName, role } = state.user;
  const topTabs = topTabsFor(role);
  const subtabs = subtabsFor(role, pathname);
  const activeTopTab = topTabForPath(role, pathname);
  const category = categoryForPath(pathname);

  const endSession = async () => {
    // Leave the guarded area first. Signing out while still on a guarded route
    // makes the guard redirect to `/login?next=…`, which would send the next
    // person straight back to the last one's screen.
    await navigate('/login', { replace: true });
    await signOut();
  };

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to main content
      </a>

      <header className={styles.header}>
        <Link className={styles.wordmark} to="/">
          <img alt="Food Bank" className={styles.wordmarkLogo} src={foodbankLogo} />
        </Link>

        {topTabs.length > 0 && (
          <nav aria-label="Main navigation" className={styles.topTabs}>
            <ul className={styles.navList}>
              {topTabs.map((item) => {
                const Icon = iconForTab(item.to);
                return (
                  <li data-category={categoryForPath(item.to)} key={item.to}>
                    <Link
                      aria-current={activeTopTab?.to === item.to ? 'page' : undefined}
                      className={activeTopTab?.to === item.to ? 'active' : undefined}
                      to={item.to}
                    >
                      <Icon className={styles.navIcon} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <div className={styles.account}>
          <span className={styles.userName}>{displayName}</span>
          <button
            className={classNames(styles.signOut, 'button-secondary')}
            onClick={() => {
              void endSession();
            }}
            type="button"
          >
            Sign out
          </button>
        </div>
        {subtabs.length > 0 && (
          <nav aria-label="Section navigation" className={styles.subtabs}>
            <ul className={styles.navList}>
              {subtabs.map((item) => (
                <li data-category={categoryForPath(item.to)} key={item.to}>
                  <NavLink end to={item.to}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main className={styles.main} data-category={category} id="main">
        <Outlet />
      </main>
    </div>
  );
}
