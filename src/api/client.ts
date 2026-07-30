import createClient from 'openapi-fetch';
import { authFetch, plainFetch } from './auth-fetch';
import type { paths } from './schema';

/**
 * Two clients, and the separation is deliberate.
 *
 * `api` carries the bearer token and the single-flight 401 refresh. `publicApi`
 * carries neither, and is what `/api/v1/public/*` and `/api/v1/auth/*` use: a
 * 401 from a public route is an answer, and a refresh routed through the
 * refreshing client could 401 and refresh again. `auth-fetch` repeats the path
 * check as a second lock, but structure is what makes the mistake impossible to
 * write rather than merely caught.
 *
 * **`baseUrl` is empty on purpose, and `servers[0]` from the spec must never be
 * used.** The spec advertises `http://127.0.0.1:8787`, which is a different host
 * from `localhost` and therefore a different site — the refresh cookie is
 * `SameSite=Strict`, so it would simply stop being sent and every user would be
 * signed out fifteen minutes after logging in, in a way that tests perfectly.
 * The spec's paths already carry `/api/v1`, the Worker serves the app and
 * proxies the API from one origin, so a relative URL is both correct and the
 * only thing that cannot drift into being cross-site.
 */
export const api = createClient<paths>({ baseUrl: '', fetch: authFetch });

export const publicApi = createClient<paths>({ baseUrl: '', fetch: plainFetch });
