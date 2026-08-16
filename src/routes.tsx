import { createBrowserRouter, type RouteObject } from 'react-router';
import { RequireAuth } from './auth/require-auth';
import { AppShell } from './components/app-shell';
import { NotFound } from './components/not-found';
import { RouteError } from './components/route-error';
import { HomeScreen } from './features/home/home-screen';
import { FuelHelpListScreen } from './features/fuel-help/components/fuel-help-list-screen';
import { LoginScreen } from './features/auth/login-screen';
import { PublicReferralScreen } from './features/referrals/components/public-referral-screen';
import {
  PickListPrintScreen,
  RunSessionClientScreen,
  RunSessionDetailScreen,
  RunSessionsScreen,
} from './features/pick-lists/components/run-sessions-screen';
import { ListenerSheetScreen } from './features/pick-lists/components/listener-sheet-screen';
import { SessionReferralDetailsScreen } from './features/pick-lists/components/session-referral-details-screen';
import { UnmatchedSmsScreen } from './features/pick-lists/components/sms-panel';
import { PreferenceRuleHealthScreen } from './features/pick-lists/components/preference-rule-health-screen';
import { ReferralDetailScreen } from './features/referrals/components/referral-detail-screen';
import { ReferralsScreen } from './features/referrals/components/referrals-screen';
import { ReferralSearchScreen } from './features/referrals/components/referral-search-screen';
import { AmendRecurringSessionScreen } from './features/sessions/components/amend-recurring-session-screen';
import { CreateRecurringSessionScreen } from './features/sessions/components/create-recurring-session-screen';
import { CreateSessionScreen } from './features/sessions/components/create-session-screen';
import { RecurringSessionsScreen } from './features/sessions/components/recurring-sessions-screen';
import { SessionDetailScreen } from './features/sessions/components/session-detail-screen';
import { SessionsScreen } from './features/sessions/components/sessions-screen';
import { AmendReferrerScreen } from './features/admin-setup/components/amend-referrer-screen';
import { AmendReferralReasonScreen } from './features/admin-setup/components/amend-referral-reason-screen';
import { CreateReferrerScreen } from './features/admin-setup/components/create-referrer-screen';
import { CreateReferralReasonScreen } from './features/admin-setup/components/create-referral-reason-screen';
import { ReferrersScreen } from './features/admin-setup/components/referrers-screen';
import { ReferralReasonsScreen } from './features/admin-setup/components/referral-reasons-screen';
import { AmendModelParcelScreen } from './features/model-parcels/components/amend-model-parcel-screen';
import { CreateModelParcelScreen } from './features/model-parcels/components/create-model-parcel-screen';
import { HouseholdGridScreen } from './features/model-parcels/components/household-grid-screen';
import { ModelParcelsScreen } from './features/model-parcels/components/model-parcels-screen';
import { AmendStockItemScreen } from './features/stock/components/amend-stock-item-screen';
import { CreateStockItemScreen } from './features/stock/components/create-stock-item-screen';
import { StockItemsScreen } from './features/stock/components/stock-items-screen';
import { StockLevelsScreen } from './features/stock/components/stock-levels-screen';
import { StockTakeScreen } from './features/stock/components/stock-take-screen';
import { AmendUserScreen } from './features/users/components/amend-user-screen';
import { CreateUserScreen } from './features/users/components/create-user-screen';
import { UsersScreen } from './features/users/components/users-screen';
import { ExtractScreen } from './features/extracts/components/extract-screen';

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
      /*
       * Sessions. `sessions/:sessionId` is a real fetch of its own — unlike
       * stock and users, `GET /sessions/{id}` exists and is not capped by role
       * — so it is a sibling of the list rather than a parameter on it. React
       * Router ranks static segments over dynamic ones regardless of array
       * order, so `sessions/new` and `sessions/recurring*` are never shadowed
       * by `sessions/:sessionId`.
       */
      { path: 'sessions', element: <SessionsScreen /> },
      { path: 'sessions/new', element: <CreateSessionScreen /> },
      { path: 'sessions/recurring', element: <RecurringSessionsScreen /> },
      { path: 'sessions/recurring/new', element: <CreateRecurringSessionScreen /> },
      {
        path: 'sessions/recurring/:recurringSessionId',
        element: <AmendRecurringSessionScreen />,
      },
      { path: 'sessions/:sessionId', element: <SessionDetailScreen /> },
      /*
       * Referrals: reading is both roles (`API.md` §2), amending, moving and
       * cancelling are admin only. No role guard either way — a team lead who
       * opens `/referrals/:referralId` makes the real request and gets a real
       * `200` with three fields missing, not a `403`; see `hasAdminFields` in
       * `referrals.logic.ts` and the module comment on
       * `referral-detail-screen.tsx`. `referrals/:referralId` is a static-vs-
       * dynamic sibling pair the same way `sessions/:sessionId` is, and there
       * is nothing to shadow it with — this feature has no `referrals/new`.
       * A referral is created by the public flow, or copied from an existing
       * one on the detail screen; neither is a screen of its own.
       */
      { path: 'referrals', element: <ReferralsScreen /> },
      { path: 'referrals/search', element: <ReferralSearchScreen /> },
      { path: 'referrals/:referralId', element: <ReferralDetailScreen /> },
      { path: 'run-sessions', element: <RunSessionsScreen /> },
      { path: 'run-sessions/:sessionId/print', element: <PickListPrintScreen /> },
      { path: 'run-sessions/:sessionId/listener', element: <ListenerSheetScreen /> },
      {
        path: 'run-sessions/:sessionId/referral-details',
        element: <SessionReferralDetailsScreen />,
      },
      { path: 'sms/unmatched', element: <UnmatchedSmsScreen /> },
      { path: 'run-sessions/:sessionId/clients/:parcelId', element: <RunSessionClientScreen /> },
      { path: 'run-sessions/:sessionId', element: <RunSessionDetailScreen /> },
      { path: 'preference-rules', element: <PreferenceRuleHealthScreen /> },
      { path: 'fuel-help', element: <FuelHelpListScreen /> },
      { path: 'extracts', element: <ExtractScreen /> },
      /*
       * Stock, and the role split inside it is the one that is easy to invert:
       * **taking stock is both roles, changing what stock items exist is admin
       * only.** Levels and stock takes are warehouse work, while
       * `stock/items*` is admin maintenance. No route is role-guarded either
       * way; a team lead who types an item URL makes the request and gets a
       * real 403.
       */
      { path: 'stock', element: <StockLevelsScreen /> },
      { path: 'stock/take', element: <StockTakeScreen /> },
      { path: 'stock/items', element: <StockItemsScreen /> },
      { path: 'stock/items/new', element: <CreateStockItemScreen /> },
      { path: 'stock/items/:stockItemId', element: <AmendStockItemScreen /> },
      /*
       * Model parcels and the household grid. Admin only per `API.md` §2, and
       * — as with users and stock items — no route is role-guarded: a team
       * lead who types one of these URLs makes the real request and gets a
       * real 403. `model-parcels/grid` and `model-parcels/new` are static
       * siblings of `model-parcels/:modelParcelId`, so neither is ever
       * shadowed by the dynamic route.
       */
      { path: 'model-parcels', element: <ModelParcelsScreen /> },
      { path: 'model-parcels/new', element: <CreateModelParcelScreen /> },
      { path: 'model-parcels/grid', element: <HouseholdGridScreen /> },
      { path: 'model-parcels/:modelParcelId', element: <AmendModelParcelScreen /> },
      /*
       * Admin setup: authorised referrers and reasons for referral. Admin
       * only per `API.md` §2, and — as with users, stock items and model
       * parcels — no route is role-guarded: a team lead who types one of
       * these URLs makes the real request and gets a real `403`.
       * `referrers/new` and `referral-reasons/new` are static siblings of
       * their `:id` routes, so neither is shadowed.
       */
      { path: 'referrers', element: <ReferrersScreen /> },
      { path: 'referrers/new', element: <CreateReferrerScreen /> },
      { path: 'referrers/:referrerId', element: <AmendReferrerScreen /> },
      { path: 'referral-reasons', element: <ReferralReasonsScreen /> },
      { path: 'referral-reasons/new', element: <CreateReferralReasonScreen /> },
      { path: 'referral-reasons/:reasonId', element: <AmendReferralReasonScreen /> },

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
