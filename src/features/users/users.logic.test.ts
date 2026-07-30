import { describe, expect, it } from 'vitest';
import type { Role, User } from './queries';
import {
  ROLE_LABELS,
  ROLE_OPTIONS,
  classifyLockoutConflict,
  findUserByEmail,
  isRole,
  refuseLockout,
  sortByEmail,
  splitByStatus,
} from './users.logic';

function user(overrides: Partial<User> & Pick<User, 'id'>): User {
  return {
    email: `${overrides.id}@x.com`,
    displayName: overrides.id,
    role: 'team_lead',
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-07-01T09:00:00.000Z',
    ...overrides,
  };
}

const ADMIN = user({ id: 'admin-1', displayName: 'Pete Bennett', role: 'admin' });
const OTHER_ADMIN = user({ id: 'admin-2', displayName: 'Bev Admin', role: 'admin' });
const LEAD = user({ id: 'lead-1', displayName: 'Ada Lead' });

describe('ROLE_LABELS', () => {
  it('names every role the server can send', () => {
    // A Record<Role, string> over the generated union, so this is really a
    // compile-time assertion. The runtime half catches an empty string.
    for (const label of Object.values(ROLE_LABELS)) {
      expect(label).not.toBe('');
    }
  });

  it('offers one option per role, derived from the labels', () => {
    expect(ROLE_OPTIONS.map((option) => option.value).sort()).toEqual(
      Object.keys(ROLE_LABELS).sort(),
    );
  });

  it('recognises only the roles it can label', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('team_lead')).toBe(true);
    // The database still permits `volunteer`, but no route grants one anything.
    expect(isRole('volunteer')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe('sortByEmail', () => {
  it('orders by email the way the server does, so a spliced row does not jump', () => {
    const sorted = sortByEmail([
      user({ id: 'c', email: 'c@x.com' }),
      user({ id: 'a', email: 'a@x.com' }),
    ]);

    expect(sorted.map((row) => row.email)).toEqual(['a@x.com', 'c@x.com']);
  });
});

describe('splitByStatus', () => {
  it('separates retired accounts without losing them', () => {
    const retired = user({ id: 'gone', isActive: false });

    const { active, retired: hidden } = splitByStatus([ADMIN, retired]);

    expect(active).toEqual([ADMIN]);
    expect(hidden).toEqual([retired]);
  });
});

describe('refuseLockout', () => {
  it('refuses demoting your own account, and says another administrator must do it', () => {
    const refusal = refuseLockout({
      users: [ADMIN, OTHER_ADMIN],
      actorId: ADMIN.id,
      target: ADMIN,
      change: { kind: 'role', role: 'team_lead' },
    });

    expect(refusal?.code).toBe('self');
    expect(refusal?.reason).toContain('Another administrator');
  });

  it('refuses deactivating your own account even with other admins around', () => {
    const refusal = refuseLockout({
      users: [ADMIN, OTHER_ADMIN],
      actorId: ADMIN.id,
      target: ADMIN,
      change: { kind: 'deactivate' },
    });

    expect(refusal?.code).toBe('self');
  });

  it('refuses the last active admin, phrased as what this list shows', () => {
    // It races other admins, so the copy must not claim more than it knows.
    const refusal = refuseLockout({
      users: [ADMIN, LEAD],
      actorId: LEAD.id,
      target: ADMIN,
      change: { kind: 'deactivate' },
    });

    expect(refusal?.code).toBe('last-active-admin');
    expect(refusal?.reason).toContain('As far as this list shows');
    expect(refusal?.reason).toContain('Pete Bennett');
  });

  it('counts only active admins as somebody who could still administer', () => {
    const retiredAdmin = user({ id: 'admin-3', role: 'admin', isActive: false });

    const refusal = refuseLockout({
      users: [ADMIN, retiredAdmin, LEAD],
      actorId: LEAD.id,
      target: ADMIN,
      change: { kind: 'deactivate' },
    });

    expect(refusal?.code).toBe('last-active-admin');
  });

  it('allows demoting an admin while another active admin remains', () => {
    expect(
      refuseLockout({
        users: [ADMIN, OTHER_ADMIN],
        actorId: OTHER_ADMIN.id,
        target: ADMIN,
        change: { kind: 'role', role: 'team_lead' },
      }),
    ).toBeNull();
  });

  it('allows deactivating a team lead even when they are the only one', () => {
    // The server has no such guard, and inventing one would refuse work the food
    // bank is allowed to do.
    expect(
      refuseLockout({
        users: [ADMIN, LEAD],
        actorId: ADMIN.id,
        target: LEAD,
        change: { kind: 'deactivate' },
      }),
    ).toBeNull();
  });

  it('allows promoting somebody to admin, which can never lock anyone out', () => {
    expect(
      refuseLockout({
        users: [ADMIN, LEAD],
        actorId: ADMIN.id,
        target: LEAD,
        change: { kind: 'role', role: 'admin' },
      }),
    ).toBeNull();
  });

  it('allows an admin to keep the role they already have', () => {
    expect(
      refuseLockout({
        users: [ADMIN],
        actorId: ADMIN.id,
        target: ADMIN,
        change: { kind: 'role', role: 'admin' },
      }),
    ).toBeNull();
  });

  it('does not refuse deactivating an already retired admin', () => {
    // Nothing is lost: they cannot administer anything now.
    const retiredAdmin = user({ id: 'admin-4', role: 'admin', isActive: false });

    expect(
      refuseLockout({
        users: [retiredAdmin, LEAD],
        actorId: LEAD.id,
        target: retiredAdmin,
        change: { kind: 'role', role: 'team_lead' },
      }),
    ).toBeNull();
  });
});

describe('findUserByEmail', () => {
  it('matches the way the server stores an address — trimmed and lowercased', () => {
    expect(findUserByEmail([ADMIN, LEAD], '  Admin-1@X.com ')?.id).toBe(ADMIN.id);
  });

  it('finds a retired account too, which is the match that matters most', () => {
    // There is no delete, so adding "the same person again" is a guaranteed 409
    // and reactivating is the only way out.
    const retired = user({ id: 'gone', email: 'gone@x.com', isActive: false });

    expect(findUserByEmail([ADMIN, retired], 'gone@x.com')?.id).toBe('gone');
  });

  it('treats an empty address as no match rather than matching everything', () => {
    expect(findUserByEmail([ADMIN], '   ')).toBeUndefined();
  });
});

describe('classifyLockoutConflict', () => {
  it('recognises the self-lockout refusal from the server’s own wording', () => {
    expect(classifyLockoutConflict('You cannot demote or deactivate your own account')).toBe(
      'self',
    );
  });

  it('recognises the last-active-admin refusal from the server’s own wording', () => {
    expect(classifyLockoutConflict('The last active admin cannot be demoted or deactivated')).toBe(
      'last-active-admin',
    );
  });

  it('classifies nothing it does not recognise, so the caller shows the message verbatim', () => {
    expect(classifyLockoutConflict('A user with that email address already exists')).toBe(
      'unclassified',
    );
  });
});

describe('the role type', () => {
  it('is the generated union, so a new server role fails to compile here first', () => {
    const roles: Role[] = ['admin', 'team_lead'];

    expect(roles.every(isRole)).toBe(true);
  });
});
