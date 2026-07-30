import { Link, useRouteError } from 'react-router';
import { ErrorNotice } from './error-notice';
import styles from './route-error.module.css';

/**
 * The router's error boundary, rendering the shared error surface.
 *
 * Without an `errorElement` React Router shows its own default: a stack trace on
 * a white page. That is a fine thing for a developer and a frightening one for a
 * volunteer holding a printed pick list in a hall.
 *
 * It replaces the shell rather than rendering inside it — that is how a route
 * `errorElement` works, the element of the route it is attached to is not
 * rendered — so it carries its own way out.
 */
export function RouteError() {
  const error = useRouteError();

  return (
    <main className={styles.screen}>
      <ErrorNotice
        error={error}
        onRetry={() => {
          // Nothing local to re-run: the component tree that threw is gone and
          // there are no route loaders to revalidate. A reload rebuilds the
          // session from the refresh cookie and starts again.
          window.location.reload();
        }}
      />
      <p>
        <Link to="/">Go to the start page</Link>
      </p>
    </main>
  );
}
