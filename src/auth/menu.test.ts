import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import {
  categoryForPath,
  MENU,
  menuFor,
  navigationSectionsFor,
  subtabsFor,
  topTabsFor,
} from './menu';

/**
 * The role split, tested as data rather than through a rendered shell.
 *
 * `API.md` section 2 is the authority for every expectation in here. The one
 * that is easy to invert, and the reason this file leads with it: **moving stock
 * is both roles, changing what stock items exist is admin only.** A menu item
 * that 403s on save is a bug that only shows up in a hall, mid-session.
 */

function labels(role: 'admin' | 'team_lead' | 'fuel_admin'): string[] {
  return menuFor(role).map((item) => item.label);
}

describe('menuFor', () => {
  it('omits admin-only items from a team lead’s menu', () => {
    const teamLead = labels('team_lead');

    expect(teamLead).not.toContain('Stock items');
    expect(teamLead).not.toContain('Approved referrers');
    expect(teamLead).not.toContain('Reasons for Crisis');
    expect(teamLead).not.toContain('Users');
    expect(teamLead).not.toContain('Weekly sessions');
    expect(teamLead).not.toContain('Model parcels');
    expect(teamLead).not.toContain('Household grid');
  });

  it('gives an admin every item, including the ones a team lead cannot see', () => {
    expect(labels('admin')).toEqual(MENU.map((item) => item.label));
  });

  it('gives a fuel administrator only the fuel help list', () => {
    expect(labels('fuel_admin')).toEqual(['Fuel']);
  });

  it('offers a team lead the stock work but not the stock item list', () => {
    // Shops, stock takes and corrections are both roles; maintaining the list of
    // stock items is admin only. Getting this backwards gives a team lead a link
    // that fails on save, or hides the work they are there to do.
    const teamLead = labels('team_lead');

    expect(teamLead).toContain('Stock');
    expect(teamLead).not.toContain('Record a shop');
    expect(teamLead).toContain('Stock take');
    expect(teamLead).not.toContain('Stock items');

    // The shopping list is worked out from a target list a team lead only
    // reads; maintaining the target lists is admin work.
    expect(teamLead).toContain('Shopping');
    expect(teamLead).not.toContain('Target lists');
  });

  it('gives a team lead the operational session work, not maintenance referrals or sessions', () => {
    const teamLead = labels('team_lead');

    expect(teamLead).toContain('Run a session');
    expect(teamLead).not.toContain('Manage Sessions');
    expect(teamLead).not.toContain('Check referrals');
  });

  it('keeps model parcels and the household grid admin-only', () => {
    // Easy to get backwards the other way from the stock split: a team lead
    // runs sessions against whatever the grid already says, but does not
    // decide what a household size receives.
    expect(labels('admin')).toContain('Model parcels');
    expect(labels('admin')).toContain('Parcel Grid');
    expect(labels('team_lead')).not.toContain('Model parcels');
    expect(labels('team_lead')).not.toContain('Parcel Grid');
  });

  it('never returns an item the role is not listed on', () => {
    for (const role of ['admin', 'team_lead', 'fuel_admin'] as const) {
      for (const item of menuFor(role)) {
        expect(item.roles).toContain(role);
      }
    }
  });
});

describe('contextual navigation', () => {
  it('keeps Sessions out of team lead navigation while retaining their operational routes', () => {
    expect(topTabsFor('team_lead').map((item) => item.label)).toEqual([
      'Dashboard',
      'Run a session',
      'Stock',
    ]);
    expect(subtabsFor('team_lead', '/stock/take').map((item) => item.label)).toEqual([
      'Stock',
      'Stock take',
      'Shopping',
    ]);
  });

  it('offers a team lead the Shopping screen but not target-list maintenance', () => {
    const stock = subtabsFor('team_lead', '/stock/shopping').map((item) => item.label);
    expect(stock).toContain('Shopping');
    expect(stock).not.toContain('Target lists');
    expect(subtabsFor('admin', '/stock/target-lists').map((item) => item.label)).toEqual([
      'Stock',
      'Stock take',
      'Stock items',
      'Target lists',
      'Shopping',
      'Model parcels',
      'Parcel Grid',
    ]);
  });

  it('moves every administrator maintenance destination under one primary section', () => {
    const contextualItems = navigationSectionsFor('admin').flatMap((section) => section.subtabs);
    const primaryItems = topTabsFor('admin');
    const destinations = new Set([...primaryItems, ...contextualItems].map((item) => item.to));

    expect(destinations).toEqual(
      new Set(MENU.filter((item) => item.to !== '/run-sessions').map((item) => item.to)),
    );
  });

  it('uses the existing list screens as each requested default destination', () => {
    expect(topTabsFor('admin').map((item) => item.to)).toEqual([
      '/',
      '/referrals',
      '/stock',
      '/sessions',
      '/referrers',
    ]);
    expect(subtabsFor('admin', '/referrals').at(0)?.label).toBe('Check referrals');
    expect(subtabsFor('admin', '/stock').at(0)?.label).toBe('Stock');
    expect(subtabsFor('admin', '/sessions').at(0)?.label).toBe('Manage Sessions');
  });

  it('keeps referral work together and puts master-data maintenance in its requested order', () => {
    expect(subtabsFor('admin', '/referrals').map((item) => item.label)).toEqual([
      'Check referrals',
      'Search referrals',
      'Send to Sheets',
      'SMS Messages',
      'Fuel',
    ]);
    expect(subtabsFor('admin', '/referrers').map((item) => item.label)).toEqual([
      'Approved referrers',
      'Users',
      'Reasons for Crisis',
      'Rule check',
      'Christmas vouchers',
    ]);
  });
});

describe('MENU', () => {
  it('every menu item points at a route that exists', () => {
    /*
     * Cheap, and it catches the rename that leaves a volunteer tapping a dead
     * link. The catch-all `*` matches everything, so "matched something" proves
     * nothing on its own — what matters is that the match is not the 404.
     */
    for (const item of MENU) {
      const matched = matchRoutes(routes, item.to);

      expect(matched, `${item.to} matches no route`).not.toBeNull();
      expect(matched?.at(-1)?.route.path, `${item.to} falls through to the 404 route`).not.toBe(
        '*',
      );
    }
  });

  it('links to paths on this origin only', () => {
    // A menu entry is rendered by NavLink, which would happily route to
    // anything. Nothing in the menu is ever off-origin.
    for (const item of MENU) {
      expect(item.to.startsWith('/'), `${item.to} is not a path`).toBe(true);
      expect(item.to.startsWith('//'), `${item.to} is protocol-relative`).toBe(false);
    }
  });
});

describe('categoryForPath', () => {
  it.each([
    ['/sessions', 'sessions'],
    ['/run-sessions/session-1', 'sessions'],
    ['/referrals/referral-1', 'referrals'],
    ['/sms', 'referrals'],
    ['/fuel-help', 'referrals'],
    ['/stock/take', 'stock'],
    ['/model-parcels/grid', 'stock'],
  ] as const)('gives %s the %s visual category', (path, expected) => {
    expect(categoryForPath(path)).toBe(expected);
  });
});
