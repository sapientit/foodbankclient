/* `__CLIENT_BUILD_VERSION__` is supplied by Vite for each production bundle.
 * `typeof` keeps direct unit tests independent of Vite's build transform. */
declare const __CLIENT_BUILD_VERSION__: string;

const CLIENT_BUILD_VERSION =
  typeof __CLIENT_BUILD_VERSION__ === 'string' ? __CLIENT_BUILD_VERSION__ : 'test-build';

interface DeployedVersion {
  readonly version: string;
}

/**
 * On sign-in only, move a page that has been left open across a deployment on
 * to the current client. Reloading in the middle of referral or stock work
 * would discard unsaved edits, so callers must never use this after sign-in.
 */
export async function reloadForNewerClient(
  nextPath: string,
  fetchVersion: typeof fetch = fetch,
  replace: (path: string) => void = (path) => {
    window.location.replace(path);
  },
): Promise<boolean> {
  // Vite does not inject a build revision in development, while the proxy
  // serves the last generated client-version.json. Comparing the two would
  // force a reload after every local sign-in — particularly harmful in Safari,
  // which may not retain the Secure refresh cookie over HTTP localhost.
  if (import.meta.env.DEV) return false;

  try {
    const response = await fetchVersion('/client-version.json', { cache: 'no-store' });
    if (!response.ok) return false;

    const deployed = parseDeployedVersion(await response.json());
    if (deployed === null || deployed.version === CLIENT_BUILD_VERSION) return false;

    replace(nextPath);
    return true;
  } catch {
    // Version checking must never prevent somebody signing in when a hall's
    // connection is unreliable. Their existing client remains usable.
    return false;
  }
}

function parseDeployedVersion(value: unknown): DeployedVersion | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'string' ||
    value.version === ''
  ) {
    return null;
  }
  return { version: value.version };
}
