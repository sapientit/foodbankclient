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
  { to: '/model-parcels', label: 'Model parcels', roles: EVERYONE },

  // Maintaining the stock item list is not the same thing as moving stock.
  { to: '/stock/items', label: 'Stock items', roles: ADMIN_ONLY },
  { to: '/referrers', label: 'Referrers', roles: ADMIN_ONLY },
  { to: '/referral-form', label: 'Referral form', roles: ADMIN_ONLY },
  { to: '/users', label: 'Users', roles: ADMIN_ONLY },
];

export function menuFor(role: Role): MenuItem[] {
  return MENU.filter((item) => item.roles.includes(role));
}
