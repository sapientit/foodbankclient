/**
 * Serves the built SPA and forwards `/api/*` to the API over a service binding,
 * so the client and the API are one origin.
 *
 * Forced by the API's refresh cookie — `HttpOnly; Secure; SameSite=Strict;
 * Path=/api/v1/auth`. A browser will not send a `SameSite=Strict` cookie on a
 * cross-site request, and `*.workers.dev` is on the Public Suffix List, so two
 * `workers.dev` hostnames are two different sites. Deployed as two origins,
 * refresh fails silently and every user is signed out fifteen minutes after
 * logging in — while passing every test short enough for anyone to sit through.
 * See CLAUDE.md, "Deploy as one origin, not two".
 */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/')) {
      /*
       * Forwarded unmodified, and returned unmodified.
       *
       * The API rate-limits on `cf-connecting-ip` and verifies Turnstile from
       * the same request. Rebuilding it with a fresh `Headers` — the obvious
       * tidy-up — drops both, which turns per-IP limiting into per-datacentre
       * limiting on an open, unauthenticated write. Returning the response
       * as-is is what gets `Set-Cookie` to the browser byte for byte, and
       * keeping the `/api/v1` prefix is what keeps the cookie's
       * `Path=/api/v1/auth` matching. Do not rewrite paths.
       */
      return env.API.fetch(request);
    }

    /*
     * Unreachable in production while `run_worker_first: ["/api/*"]` is set,
     * because static assets are served before this Worker runs at all.
     *
     * Not dead code: it is the whole of the Worker's correctness if that
     * setting is ever removed or narrowed, and it is what serves assets under
     * `vite dev`. Deleting it would leave a Worker that 404s the app.
     */
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
