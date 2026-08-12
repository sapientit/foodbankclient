import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { menuGroupsFor } from '../auth/menu';
import styles from './app-shell.module.css';

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
 * `aria-current` on the active link, a real disclosure button with
 * `aria-expanded`/`aria-controls` and Escape-to-close, and focus that returns to
 * the button it came from.
 */
export function AppShell() {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();

  const navId = useId();
  const [navOpen, setNavOpen] = useState(false);
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!navOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNavOpen(false);
      // Escape must not strand focus on a control that has just disappeared.
      disclosureRef.current?.focus();
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!navRef.current?.contains(target) && !disclosureRef.current?.contains(target)) {
        setNavOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [navOpen]);

  /*
   * The shell only ever renders inside `RequireAuth`, which does not render its
   * children until the session is known. Narrowing rather than asserting keeps
   * that invariant in the type system instead of behind a `!`.
   */
  if (state.status !== 'signed-in') return null;

  const { displayName, role } = state.user;

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
          Food Bank
        </Link>

        <button
          aria-controls={navId}
          aria-expanded={navOpen}
          className={styles.disclosure}
          onClick={() => {
            setNavOpen((open) => !open);
          }}
          ref={disclosureRef}
          type="button"
        >
          Menu
        </button>

        <nav aria-label="Main" className={styles.nav} data-open={navOpen} id={navId} ref={navRef}>
          {menuGroupsFor(role).map((group, groupIndex) => (
            <section
              className={styles.menuGroup}
              key={group.label || `ungrouped-${String(groupIndex)}`}
            >
              {group.label !== '' && <p className={styles.groupLabel}>{group.label}</p>}
              <ul className={styles.navList}>
                {group.items.map((item) => (
                  <li key={item.to}>
                    {/* NavLink sets aria-current="page" on the active link by
                    default, and the stylesheet selects on that attribute rather
                    than on a class — so what a screen reader announces and what
                    a volunteer sees cannot drift apart. `end` matters because
                    /stock would otherwise stay marked current on /stock/items. */}
                    <NavLink
                      end
                      onClick={() => {
                        // Following a link on a phone would otherwise leave the
                        // menu covering the screen it just navigated to.
                        setNavOpen(false);
                      }}
                      to={item.to}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <div className={styles.account}>
          <span className={styles.userName}>{displayName}</span>
          <button
            className={styles.signOut}
            onClick={() => {
              void endSession();
            }}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.main} id="main">
        <Outlet />
      </main>
    </div>
  );
}
