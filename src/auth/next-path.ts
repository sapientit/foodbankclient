import type { components } from '../api/schema';

/**
 * `?next=` decides where the app sends someone after they sign in, and it
 * arrives from the URL bar. Anything that is not a path on this origin is an
 * open redirect: `//evil.example` is a protocol-relative URL that a browser
 * treats as another host, and `https://evil.example` obviously so.
 *
 * So only a same-origin path is ever accepted, and only a path is ever written —
 * never a full URL, and never anything about the person signing in.
 */

export const DEFAULT_NEXT_PATH = '/';

type Role = components['schemas']['Role'];

export function safeNextPath(next: string | null): string {
  if (next === null) return DEFAULT_NEXT_PATH;
  if (!next.startsWith('/')) return DEFAULT_NEXT_PATH;

  // `//host` and `/\host` are both read as protocol-relative by some parsers.
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_NEXT_PATH;

  return next;
}

/**
 * The fuel administrator has no staff landing screen: their one permitted
 * workflow is the fuel help list. A typed, non-root return path is still kept
 * so the server can give its normal 403 explanation if a stale link is opened.
 */
export function postLoginPath(next: string | null, role: Role): string {
  const safe = safeNextPath(next);

  return safe === '/' && role === 'fuel_admin' ? '/fuel-help' : safe;
}
