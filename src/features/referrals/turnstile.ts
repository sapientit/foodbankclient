import { ShowableError } from '../../lib/errors';

/**
 * The boundary between this client and Cloudflare's Turnstile script.
 *
 * **Everything about the third-party global lives here**, in the same shape as
 * `extracts/google-auth.ts`: one `declare global`, one loader, and no component
 * reaching for `window` itself. The component beside this file decides what a
 * referrer sees; this decides nothing.
 *
 * **Whether the charity has accepted this is not recorded anywhere.**
 * `.claude/rules/pii-security.md` says their acceptance of the spreadsheet
 * extract "covers `/extracts` and nothing else; anything new that sends data
 * off-origin needs its own", and this loads a Cloudflare script into the page a
 * referrer is typing a household's details into. Raised as `OPEN-QUESTIONS.md`
 * Q42 in `OPEN-QUESTIONS.md` — **only Pete closes it.** The mitigation available is a CSP `script-src`
 * naming this origin, and nothing else.
 *
 * **Turnstile is required only when a sitekey is configured**, which mirrors the
 * server exactly — it verifies the token whenever it has a secret, skips when it
 * does not, and refuses to boot in production without one. So an unconfigured
 * client and an unconfigured server agree, and a configured pair agree; the
 * broken combination is a configured server with an unconfigured client, and
 * that one fails loudly on the first submission rather than quietly.
 */

declare global {
  interface Window {
    turnstile?: {
      render(
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback': () => void;
          'error-callback': () => void;
        },
      ): string | undefined;
      reset(widgetId: string): void;
      remove(widgetId: string): void;
    };
  }
}

/**
 * `render=explicit`, so nothing is drawn until the component asks.
 *
 * The automatic mode scans the document for a magic class name, which would
 * render the widget at a moment React knows nothing about and leave a second one
 * behind on every re-render.
 */
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * The sitekey, or `null` when this deployment has none.
 *
 * Read through a function rather than a module constant so a test can turn it on
 * and off — and read at the point of use rather than captured at import, for the
 * same reason. It is public by design: Vite compiles it into the bundle, which
 * is where a sitekey belongs. The secret half never comes near this repository.
 */
export function turnstileSiteKey(): string | null {
  const key: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof key === 'string' && key !== '' ? key : null;
}

let loading: Promise<void> | null = null;

/**
 * Loads the script once per page, however many callers ask.
 *
 * The promise is cached rather than the script element checked, because two
 * mounts in the same tick both see no script and both append one — and the
 * second widget renders into a container the first has already claimed.
 */
export function loadTurnstile(): Promise<void> {
  if (window.turnstile !== undefined) return Promise.resolve();
  if (loading !== null) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      // Cleared so a referrer who loses their connection for a moment is not
      // stuck with a permanently rejected promise for the rest of the form.
      loading = null;
      script.remove();
      reject(new ShowableError('The security check could not load.'));
    };
    document.head.append(script);
  });

  return loading;
}

/** Test seam: forget the cached load so each test starts from nothing. */
export function resetTurnstileLoaderForTests(): void {
  loading = null;
}
