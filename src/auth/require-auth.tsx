import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Spinner } from '../components/spinner';
import { useAuth } from './auth-context';
import styles from './require-auth.module.css';

/**
 * The route guard, and the thing that starts the session restore.
 *
 * **There is no role guard here, and there must not be one.** Roles pick menus.
 * A team lead who types an admin URL makes the request and gets a real `403`
 * from the server, which is the only check that means anything — the server
 * re-reads the role from the signed token on every request, so a client-side
 * gate would only hide the menu item someone already edited their way past.
 * What the app owes them is a readable explanation, which is what
 * `describeApiError` in lib/errors.ts is for.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, restoreSession } = useAuth();
  const location = useLocation();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  switch (state.status) {
    case 'unknown':
    case 'restoring':
      // Not the sign-in screen. Rendering that here is the flash of "you are
      // signed out" that every reload would otherwise show for a round trip.
      return <RestoringSession />;

    case 'signed-out': {
      const next = `${location.pathname}${location.search}`;
      return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }

    case 'signed-in':
      return children;
  }
}

function RestoringSession() {
  return (
    <div className={styles.restoring}>
      {/* `delayMs={0}`: the shared spinner waits 150 ms so a cached response
          does not flash, but here the spinner *is* the page — the whole screen
          is blank until the refresh resolves, and a blank screen reads worse
          than a spinner that arrives at once. */}
      <Spinner delayMs={0} label="Signing you in…" />
    </div>
  );
}
