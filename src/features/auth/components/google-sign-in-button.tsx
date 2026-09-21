import { useEffect, useRef, useState } from 'react';
import { googleSignInClientId, loadGoogleIdentityServices } from '../google-signin';
import styles from './google-sign-in-button.module.css';

/**
 * The Google sign-in button, rendered by Google's own script into the
 * container below rather than built from scratch — its branding is Google's
 * requirement, not a design choice this app gets to make.
 *
 * **Renders nothing when no client id is configured**, matching how
 * `TurnstileCheck` renders nothing without a sitekey and the server refuses
 * to start `AUTH_MODE=google` without one either.
 *
 * The credential (an ID token) is reported upward and never held here or
 * sent anywhere by this component — `LoginScreen` is what calls the server.
 */
export function GoogleSignInButton({ onCredential }: { onCredential: (idToken: string) => void }) {
  const clientId = googleSignInClientId();
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // See TurnstileCheck for why this is a ref: the mount effect below must not
  // depend on a callback the screen rebuilds most renders.
  const report = useRef(onCredential);
  useEffect(() => {
    report.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (clientId === null) return undefined;

    let cancelled = false;

    void loadGoogleIdentityServices()
      .then(() => {
        // StrictMode mounts twice in development; without this the second
        // pass initialises again and renders a second button.
        if (cancelled || container.current === null) return;

        window.google?.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (typeof response.credential === 'string') {
              setFailed(false);
              report.current(response.credential);
            } else {
              setFailed(true);
            }
          },
        });
        window.google?.accounts.id.renderButton(container.current, { type: 'standard' });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (clientId === null) return null;

  return (
    <div className={styles.wrapper}>
      <div ref={container} />
      <p aria-atomic="true" className={styles.status} role="status">
        {failed ? 'Google sign-in could not load. Reload the page and try again.' : ''}
      </p>
    </div>
  );
}
