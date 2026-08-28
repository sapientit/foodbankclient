import { Link, Navigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { menuGroupsFor } from '../../auth/menu';
import { PageHeader } from '../../components/page-header';
import styles from './home-screen.module.css';

/**
 * The start page, and deliberately thin.
 *
 * What belongs here is today's sessions, and sessions are a later slice. So it
 * shows the two things it actually knows — who is signed in and what that
 * account can do — and invents nothing. A dashboard of placeholder counts would
 * be a lie about data nobody has yet, and the first person to read a fake zero
 * as real would be a volunteer deciding whether to open up.
 */
export function HomeScreen() {
  const { state } = useAuth();

  // Rendered inside the shell, which renders inside `RequireAuth`. Narrowing
  // rather than asserting; see AppShell.
  if (state.status !== 'signed-in') return null;

  const { displayName, role } = state.user;

  // A fuel administrator has one screen rather than a staff dashboard with
  // everything removed. This is navigation only; the server remains the access
  // control for every endpoint and route.
  if (role === 'fuel_admin') return <Navigate replace to="/fuel-help" />;

  return (
    <>
      <PageHeader title="Food Bank" />

      <p>
        Signed in as <strong>{displayName}</strong>,{' '}
        {role === 'admin' ? 'an administrator' : 'a team lead'}.
      </p>

      <p>Today&rsquo;s sessions will appear here once that part of the app is built.</p>

      <h2>What you can do</h2>
      {menuGroupsFor(role).map((group, groupIndex) => (
        <section
          aria-labelledby={group.label === '' ? undefined : `menu-group-${String(groupIndex)}`}
          className={styles.menuGroup}
          key={group.label || `ungrouped-${String(groupIndex)}`}
        >
          {group.label !== '' && <h3 id={`menu-group-${String(groupIndex)}`}>{group.label}</h3>}
          <ul className={styles.menuItems}>
            {group.items.map((item) => (
              <li key={item.to}>
                <Link className="button-link" to={item.to}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
