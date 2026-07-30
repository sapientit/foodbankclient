import { createBrowserRouter, type RouteObject } from 'react-router';
import { RequireAuth } from './auth/require-auth';
import { AppShell } from './components/app-shell';
import { NotBuiltYet } from './components/not-built-yet';
import { NotFound } from './components/not-found';
import { RouteError } from './components/route-error';
import { HomeScreen } from './features/home/home-screen';
import { LoginScreen } from './features/auth/login-screen';
import { PublicReferralScreen } from './features/referrals/components/public-referral-screen';
import { AmendUserScreen } from './features/users/components/amend-user-screen';
import { CreateUserScreen } from './features/users/components/create-user-screen';
import { UsersScreen } from './features/users/components/users-screen';

/**
 * The route table, and the shape of it is the point.
 *
 * ```
 * /                      RequireAuth + AppShell   (pathless layout)
 *   index                Home
 *   sessions, stock, …   the authenticated screens
 * /login                 sibling — no shell, no guard
 * /refer/*               sibling — the public referral flow
 * *                      404
 * ```
 *
 * **The guard and the shell hang off a pathless layout route, not off the
 * router.** That is what makes an unauthenticated route a plain sibling instead
 * of an exception. The public referral flow is the whole reason: it is
 * unauthenticated, it is the only open write in the system, and it must never
 * pay for an auth round trip. Wiring the guard at the top and carving holes in
 * it would mean threading an "is this public?" flag through a provider, and
 * every future public page would have to remember to set it. Here, adding one is
 * a pure addition — a new sibling, nothing else touched.
 *
 * **`/refer` is reserved now, deliberately.** It shows the two public endpoints
 * that exist — sessions with space, and whether an address may refer — and says
 * plainly that referrals are not taken online yet, rather than pretending to be
 * a form. It is in the table so nobody nests the real thing under the
 * authenticated layout later and only finds out when a referrer is asked to sign
 * in.
 *
 * **Fetching goes through TanStack Query hooks, never route loaders.** Both work
 * and this is a data router, so a loader is one `loader:` key away — do not add
 * one. The two mechanisms do not share a cache, an auth path or a retry policy,
 * so mixing them gives this app two of each: a mutation would invalidate a query
 * key that a loader never reads, a loader's 401 would bypass the single-flight
 * refresh in `auth-fetch`, and the "do not retry a 4xx" rule would hold on one
 * path and not the other. One mechanism, chosen because server state is already
 * TanStack Query's job everywhere else.
 */
export const routes: RouteObject[] = [
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    // Renders the shared error surface instead of React Router's default stack
    // trace when a screen throws — an ApiError that reached render, most often.
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeScreen /> },

      /*
       * Reserved by the menu, built by later slices. They are routed now so that
       * `MENU` never points at nothing: a link that 404s in a hall is worse than
       * a screen that admits it does not exist yet. Each one is replaced in
       * place as its slice lands.
       */
      { path: 'sessions', element: <NotBuiltYet title="Sessions" /> },
      { path: 'referrals', element: <NotBuiltYet title="Referrals" /> },
      { path: 'stock', element: <NotBuiltYet title="Stock" /> },
      { path: 'stock/items', element: <NotBuiltYet title="Stock items" /> },
      { path: 'model-parcels', element: <NotBuiltYet title="Model parcels" /> },
      { path: 'referrers', element: <NotBuiltYet title="Referrers" /> },
      { path: 'referral-form', element: <NotBuiltYet title="Referral form" /> },

      /*
       * User maintenance. Three screens and no role guard on any of them: a team
       * lead who types one of these URLs makes the request and gets a real 403,
       * rendered as an explanation. See `require-auth.tsx`.
       *
       * `users/:userId` is a projection of the list — there is no
       * `GET /users/{id}` — which is why it can deep-link a retired account.
       */
      { path: 'users', element: <UsersScreen /> },
      { path: 'users/new', element: <CreateUserScreen /> },
      { path: 'users/:userId', element: <AmendUserScreen /> },
    ],
  },

  { path: '/login', element: <LoginScreen /> },

  // Splat: the real flow has steps under it (the form, the confirmation, the
  // fifteen-minute edit window) and none of them may fall through to the 404.
  { path: '/refer/*', element: <PublicReferralScreen /> },

  /*
   * **Required, not optional.** `wrangler.jsonc` sets
   * `not_found_handling: "single-page-application"`, so the origin answers an
   * unknown path with `index.html` and HTTP 200 — there is no server 404 behind
   * this. Without this route a mistyped or stale link boots the app, matches
   * nothing, and renders a blank page that reads as "the app is broken".
   */
  { path: '*', element: <NotFound /> },
];

export const router = createBrowserRouter(routes);
