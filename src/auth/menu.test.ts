import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import { MENU, menuFor, menuGroupsFor } from './menu';

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

describe('menuGroupsFor', () => {
  it('organises the administrator popup in the requested order', () => {
    expect(menuGroupsFor('admin')).toMatchObject([
      {
        label: 'Referrals',
        items: expect.arrayContaining([expect.objectContaining({ label: 'Run a session' })]),
      },
      {
        label: 'Stock',
        items: expect.arrayContaining([expect.objectContaining({ label: 'Stock take' })]),
      },
      {
        label: 'Sessions',
        items: expect.arrayContaining([expect.objectContaining({ label: 'Manage Sessions' })]),
      },
      {
        label: 'Master Data',
        items: expect.arrayContaining([expect.objectContaining({ label: 'Users' })]),
      },
      {
        label: '',
        items: expect.arrayContaining([
          expect.objectContaining({ label: 'SMS Messages' }),
          expect.objectContaining({ label: 'Fuel' }),
        ]),
      },
    ]);
  });

  it('keeps the team lead popup as one ungrouped list', () => {
    expect(menuGroupsFor('team_lead')).toEqual([{ label: '', items: menuFor('team_lead') }]);
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
