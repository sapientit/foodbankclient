import { ShowableError } from '../../lib/errors';

/**
 * The boundary between this client and Google Identity Services' sign-in
 * button, in the same shape as `referrals/turnstile.ts`: one loader, no
 * component reaching for `window` itself.
 *
 * `window.google`'s type is declared once in `extracts/google-auth.ts`,
 * shared with this file since both load the same script — see the comment
 * there before adding to it.
 */

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

/**
 * The OAuth client id ID tokens are checked against, or `null` when this
 * deployment has none. Public by design — Vite compiles it into the bundle,
 * which is where a client id belongs; the matching secret never comes near
 * this repository, and this flow does not use one anyway (`google-provider.ts`
 * on the server only ever verifies a token, never exchanges a code).
 */
export function googleSignInClientId(): string | null {
  const id: unknown = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * Which sign-in screen to show, fixed per deployment at build time — the same
 * mechanism `CLOUDFLARE_ENV` already uses to pick the wrangler environment.
 * `INITIAL_SPEC1.txt` (`#Login`) is explicit that a deployment runs one or
 * the other, never both, so this is a build-time choice rather than
 * something the app decides at runtime by asking the server.
 */
export function isGoogleSignInMode(): boolean {
  return import.meta.env.VITE_AUTH_MODE === 'google';
}

let loading: Promise<void> | null = null;

/** Loads the script once per page, however many callers ask. */
export function loadGoogleIdentityServices(): Promise<void> {
  if (window.google !== undefined) return Promise.resolve();
  if (loading !== null) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new ShowableError('Google sign-in could not load.'));
    };
    document.head.append(script);
  });

  return loading;
}

/** Test seam: forget the cached load so each test starts from nothing. */
export function resetGoogleIdentityServicesLoaderForTests(): void {
  loading = null;
}
