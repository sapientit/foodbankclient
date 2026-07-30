import { Link } from 'react-router';
import { PageHeader } from './page-header';
import styles from './not-found.module.css';

/**
 * The catch-all screen, and it is required rather than nice to have.
 *
 * `wrangler.jsonc` sets `not_found_handling: "single-page-application"`, so the
 * origin answers an unknown path with `index.html` and **HTTP 200**. There is no
 * server-side 404 to fall back on: without this screen a mistyped or stale link
 * boots the app, matches nothing, and renders an empty page that looks like the
 * app is broken.
 */
export function NotFound() {
  return (
    <main className={styles.screen}>
      <PageHeader title="Page not found" />
      <p>
        There is nothing at this address. The link may be out of date, or the address may have been
        mistyped.
      </p>
      <p>
        <Link to="/">Go to the start page</Link>
      </p>
    </main>
  );
}
