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
 * items exist is admin only.** A team lead does the shops, the stock takes and
 * the corrections; only an admin maintains the stock item list.
 */

export type Role = components['schemas']['Role'];

export interface MenuItem {
  readonly to: string;
  readonly label: string;
  readonly roles: readonly Role[];
}

const EVERYONE: readonly Role[] = ['admin', 'team_lead'];
const ADMIN_ONLY: readonly Role[] = ['admin'];

export const MENU: readonly MenuItem[] = [
  // Running a session — pick lists, printing, attendance — is a team lead's job
  // as much as an admin's. Creating and amending sessions is not, but that is a
  // control on the screen, not a reason to hide it.
  { to: '/sessions', label: 'Sessions', roles: EVERYONE },
  { to: '/referrals', label: 'Referrals', roles: EVERYONE },
  { to: '/stock', label: 'Stock', roles: EVERYONE },

  // Recording a shop and running a stock take are both roles, and getting this
  // wrong hides from a team lead the two jobs they are actually in the
  // warehouse to do. `openapi.yaml` says "Admin or team lead" on every endpoint
  // behind both.
  { to: '/stock/shop', label: 'Record a shop', roles: EVERYONE },
  { to: '/stock/take', label: 'Stock take', roles: EVERYONE },

  // Maintaining the stock item list is not the same thing as moving stock.
  { to: '/stock/items', label: 'Stock items', roles: ADMIN_ONLY },

  // Model parcels and the household grid decide what a household receives —
  // `API.md` §2 puts this admin-only, alongside the stock item list and the
  // rest of the maintenance screens. A team lead runs sessions against
  // whatever the grid already says; they do not edit the grid itself.
  { to: '/model-parcels', label: 'Model parcels', roles: ADMIN_ONLY },
  { to: '/model-parcels/grid', label: 'Household grid', roles: ADMIN_ONLY },

  // Setting up the weekly templates sessions are generated from is
  // create-or-amend-a-session work, so it follows that split: admin only,
  // same as `Create or amend sessions and referrals` in `API.md` §2.
  { to: '/sessions/recurring', label: 'Weekly sessions', roles: ADMIN_ONLY },
  { to: '/referrers', label: 'Referrers', roles: ADMIN_ONLY },
  { to: '/referral-reasons', label: 'Reasons for referral', roles: ADMIN_ONLY },
  { to: '/users', label: 'Users', roles: ADMIN_ONLY },
];

export function menuFor(role: Role): MenuItem[] {
  return MENU.filter((item) => item.roles.includes(role));
}
