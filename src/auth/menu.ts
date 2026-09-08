import type { components } from '../api/schema';

/**
 * The navigation, as data.
 *
 * Declarative on purpose: the role split is the thing most likely to be got
 * subtly wrong, and a table can be tested without rendering anything. The
 * alternative — `{role === 'admin' && <NavLink …>}` scattered through the shell —
 * is only checkable by mounting a component per role and reading the DOM.
 *
 * **Roles pick menus and nothing else.** The server re-checks the role on every
 * request from the signed token, so someone who edits `role` in devtools sees
 * extra links and gets a `403` on each of them. Nothing here is access control.
 *
 * The split is copied from `API.md` section 2, which is the authority. The one
 * that is easy to invert: **moving stock is both roles, changing what stock
 * items exist is admin only.** A team lead carries out stock takes; only an
 * admin maintains the stock item list.
 */

export type Role = components['schemas']['Role'];

export interface MenuItem {
  readonly to: string;
  readonly label: string;
  readonly roles: readonly Role[];
}

export interface NavigationSection {
  readonly tab: MenuItem;
  readonly subtabs: readonly MenuItem[];
  readonly paths: readonly string[];
}

export type NavigationCategory = 'sessions' | 'referrals' | 'stock' | 'master-data';

const SESSION_STAFF: readonly Role[] = ['admin', 'team_lead'];
const ADMIN_ONLY: readonly Role[] = ['admin'];
const FUEL_HELP_STAFF: readonly Role[] = ['admin', 'fuel_admin'];

export const MENU: readonly MenuItem[] = [
  { to: '/', label: 'Dashboard', roles: SESSION_STAFF },
  // The operational view is separate from calendar and referral maintenance:
  // a team lead arrives to run today's session, not to plan one or browse
  // household records. Administrators keep both routes so they can cover.
  { to: '/run-sessions', label: 'Run a session', roles: SESSION_STAFF },
  { to: '/sessions', label: 'Manage Sessions', roles: ADMIN_ONLY },
  { to: '/referrals', label: 'Check referrals', roles: ADMIN_ONLY },
  { to: '/referrals/search', label: 'Search referrals', roles: ADMIN_ONLY },
  { to: '/stock', label: 'Stock', roles: SESSION_STAFF },

  // The weekly stock take is operational work for both roles.
  { to: '/stock/take', label: 'Stock take', roles: SESSION_STAFF },

  // Minting a counting code for a volunteer with no account is part of running
  // the stock take, so it follows the same both-roles split. The volunteer's
  // own screen is outside the menu entirely — see `/count` in `routes.tsx`.
  { to: '/stock/volunteer-code', label: 'Volunteer code', roles: SESSION_STAFF },

  // Maintaining the stock item list is not the same thing as moving stock.
  { to: '/stock/items', label: 'Stock items', roles: ADMIN_ONLY },
  { to: '/stock/groupings', label: 'Stock groupings', roles: ADMIN_ONLY },
  { to: '/stock/crates', label: 'Crates', roles: ADMIN_ONLY },
  { to: '/stock/validation', label: 'Stock validation', roles: ADMIN_ONLY },

  // Target stock lists — the named sets of desired stock levels. Maintaining
  // them is admin work, alongside the stock item list. Generating a shopping
  // list from one is a team lead's job — they do the food shopping — so
  // `/stock/shopping` is `SESSION_STAFF`, the one part of stock maintenance a
  // team lead reaches (`API.md` §2: "Target stock lists: read" is both roles).
  { to: '/stock/target-lists', label: 'Target lists', roles: ADMIN_ONLY },
  { to: '/stock/shopping', label: 'Shopping', roles: SESSION_STAFF },

  // Model parcels and the household grid decide what a household receives —
  // `API.md` §2 puts this admin-only, alongside the stock item list and the
  // rest of the maintenance screens. A team lead runs sessions against
  // whatever the grid already says; they do not edit the grid itself.
  { to: '/model-parcels', label: 'Model parcels', roles: ADMIN_ONLY },
  { to: '/model-parcels/grid', label: 'Parcel Grid', roles: ADMIN_ONLY },

  // Setting up the weekly templates sessions are generated from is
  // create-or-amend-a-session work, so it follows that split: admin only,
  // same as `Create or amend sessions and referrals` in `API.md` §2.
  { to: '/sessions/recurring', label: 'Weekly sessions', roles: ADMIN_ONLY },
  { to: '/referrers', label: 'Approved referrers', roles: ADMIN_ONLY },
  { to: '/referral-reasons', label: 'Reasons for Crisis', roles: ADMIN_ONLY },
  { to: '/users', label: 'Users', roles: ADMIN_ONLY },
  { to: '/sms', label: 'SMS Messages', roles: ADMIN_ONLY },
  { to: '/extracts', label: 'Send to Sheets', roles: ADMIN_ONLY },
  { to: '/preference-rules', label: 'Rule check', roles: ADMIN_ONLY },
  { to: '/voucher-config', label: 'Christmas vouchers', roles: ADMIN_ONLY },
  // A fuel administrator is not a reduced staff account. This is their whole
  // application; no other navigation item is shared with that role.
  { to: '/fuel-help', label: 'Fuel', roles: FUEL_HELP_STAFF },
];

export function menuFor(role: Role): MenuItem[] {
  return MENU.filter((item) => item.roles.includes(role));
}

/** The persistent first-level navigation, with only permitted destinations. */
export function topTabsFor(role: Role): MenuItem[] {
  if (role === 'fuel_admin') return [itemAt('/fuel-help')];
  const dashboard = MENU.find((item) => item.to === '/');
  if (dashboard === undefined) throw new Error('Dashboard menu item is missing.');
  if (role === 'team_lead') return [dashboard, itemAt('/run-sessions'), itemAt('/stock')];

  const tabPaths = ['/referrals', '/stock', '/sessions', '/referrers'] as const;
  return [
    dashboard,
    ...tabPaths.map((path) => {
      const item = MENU.find((candidate) => candidate.to === path);
      if (item === undefined) throw new Error(`Dashboard tab ${path} is missing.`);
      if (path === '/referrals') return { ...item, label: 'Referrals' };
      if (path === '/sessions') return { ...item, label: 'Sessions' };
      return path === '/referrers' ? { ...item, label: 'Master Data' } : item;
    }),
  ];
}

function itemAt(path: string): MenuItem {
  const item = MENU.find((candidate) => candidate.to === path);
  if (item === undefined) throw new Error(`Navigation item ${path} is missing.`);
  return item;
}

/**
 * Each primary tab owns the old menu destinations that belong to it. This is
 * navigation presentation only: the server continues to authorise every route.
 */
export function navigationSectionsFor(role: Role): readonly NavigationSection[] {
  if (role === 'fuel_admin') return [];

  const section = (tab: MenuItem, paths: readonly string[]): NavigationSection => ({
    tab,
    paths,
    subtabs: paths.map(itemAt).filter((item) => item.roles.includes(role)),
  });

  if (role === 'team_lead') {
    return [
      section(itemAt('/stock'), [
        '/stock',
        '/stock/take',
        '/stock/volunteer-code',
        '/stock/shopping',
      ]),
    ];
  }

  return [
    section(itemAt('/referrals'), [
      '/referrals',
      '/referrals/search',
      '/extracts',
      '/sms',
      '/fuel-help',
    ]),
    section(itemAt('/stock'), [
      '/stock',
      '/stock/take',
      '/stock/volunteer-code',
      '/stock/items',
      '/stock/groupings',
      '/stock/crates',
      '/stock/validation',
      '/stock/target-lists',
      '/stock/shopping',
      '/model-parcels',
      '/model-parcels/grid',
    ]),
    section(itemAt('/sessions'), ['/sessions', '/sessions/recurring']),
    section(itemAt('/referrers'), [
      '/referrers',
      '/users',
      '/referral-reasons',
      '/preference-rules',
      '/voucher-config',
    ]),
  ];
}

/** The contextual links for the primary section that owns this URL. */
export function subtabsFor(role: Role, pathname: string): readonly MenuItem[] {
  const section = navigationSectionsFor(role).find((candidate) =>
    candidate.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
  return section?.subtabs ?? [];
}

/** The visual category follows the work a route belongs to, not a user's role. */
export function categoryForPath(pathname: string): NavigationCategory {
  if (
    ['/referrals', '/extracts', '/sms', '/fuel-help'].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return 'referrals';
  }
  if (
    ['/stock', '/model-parcels'].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return 'stock';
  }
  if (
    ['/sessions', '/run-sessions'].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return 'sessions';
  }
  return 'master-data';
}
