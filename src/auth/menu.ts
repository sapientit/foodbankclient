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

export interface MenuGroup {
  readonly label: string;
  readonly items: readonly MenuItem[];
}

const SESSION_STAFF: readonly Role[] = ['admin', 'team_lead'];
const ADMIN_ONLY: readonly Role[] = ['admin'];
const FUEL_HELP_STAFF: readonly Role[] = ['admin', 'fuel_admin'];

export const MENU: readonly MenuItem[] = [
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

  // Maintaining the stock item list is not the same thing as moving stock.
  { to: '/stock/items', label: 'Stock items', roles: ADMIN_ONLY },

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
  { to: '/sms/unmatched', label: 'SMS Messages', roles: ADMIN_ONLY },
  { to: '/extracts', label: 'Send to Sheets', roles: ADMIN_ONLY },
  { to: '/preference-rules', label: 'Preference rule check', roles: ADMIN_ONLY },
  // A fuel administrator is not a reduced staff account. This is their whole
  // application; no other navigation item is shared with that role.
  { to: '/fuel-help', label: 'Fuel', roles: FUEL_HELP_STAFF },
];

export function menuFor(role: Role): MenuItem[] {
  return MENU.filter((item) => item.roles.includes(role));
}

/** The administrator's popup follows the operational grouping requested by the charity. */
export function menuGroupsFor(role: Role): readonly MenuGroup[] {
  const items = menuFor(role);
  if (role !== 'admin') return [{ label: '', items }];

  const byPath = (path: string): MenuItem => {
    const item = items.find((candidate) => candidate.to === path);
    if (item === undefined) throw new Error(`Menu item ${path} is missing.`);
    return item;
  };

  return [
    {
      label: 'Referrals',
      items: [
        byPath('/run-sessions'),
        byPath('/referrals'),
        byPath('/referrals/search'),
        byPath('/extracts'),
      ],
    },
    {
      label: 'Stock',
      items: [
        byPath('/stock'),
        byPath('/stock/take'),
        byPath('/stock/items'),
        byPath('/model-parcels'),
        byPath('/model-parcels/grid'),
      ],
    },
    { label: 'Sessions', items: [byPath('/sessions'), byPath('/sessions/recurring')] },
    {
      label: 'Master Data',
      items: [
        byPath('/referral-reasons'),
        byPath('/users'),
        byPath('/referrers'),
        byPath('/preference-rules'),
      ],
    },
    { label: '', items: [byPath('/sms/unmatched'), byPath('/fuel-help')] },
  ];
}
