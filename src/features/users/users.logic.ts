import type { Role, User } from './queries';

/**
 * The pure half of user maintenance: the role labels, the active/retired split,
 * and the two lockout predicates the screens use to refuse a change with a
 * reason instead of letting somebody discover it in a `409`.
 *
 * No React, no fetching, tested directly. The predicates mirror
 * `users.service.ts` in the server repo deliberately — if that file's guards
 * change, these are wrong, and the tests here are where that gets noticed.
 */

/**
 * **`Record<Role, string>` over the generated union, on purpose.** The day the
 * server adds a role, this stops compiling until the UI names it — which is much
 * better than a screen rendering the string `undefined` where a job title should
 * be. Everything below derives from it, so there is one list to keep honest.
 */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  team_lead: 'Team lead',
};

export interface RoleOption {
  readonly value: Role;
  readonly label: string;
}

/** The roles a form may offer, derived from the labels so it cannot fall behind them. */
export const ROLE_OPTIONS: readonly RoleOption[] = Object.entries(ROLE_LABELS).flatMap(
  ([value, label]) => (isRole(value) ? [{ value, label }] : []),
);

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.hasOwn(ROLE_LABELS, value);
}

/**
 * The server lists users by email ascending, and stores every address
 * lowercased. Sorting the same way is what keeps a spliced-in row where a
 * refetch would have put it, instead of jumping when the invalidate lands.
 */
export function sortByEmail(users: readonly User[]): User[] {
  return [...users].sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
}

export interface UsersByStatus {
  readonly active: readonly User[];
  readonly retired: readonly User[];
}

export function splitByStatus(users: readonly User[]): UsersByStatus {
  return {
    active: users.filter((user) => user.isActive),
    retired: users.filter((user) => !user.isActive),
  };
}

/** The two amendments that can lose somebody their administrator access. */
export type UserChange =
  { readonly kind: 'deactivate' } | { readonly kind: 'role'; readonly role: Role };

export type RefusalCode = 'self' | 'last-active-admin';

export interface Refusal {
  readonly code: RefusalCode;
  readonly reason: string;
}

/**
 * Predicts the server's two lockout guards, and says why in words.
 *
 * The two are not equally safe to predict, and the difference is written into
 * the copy:
 *
 * - **Self-lockout depends only on the actor's own id and the row in front of
 *   them.** Nothing another admin does can change the answer, so it is stated
 *   flatly.
 * - **Last-active-admin races every other admin.** Another browser may have
 *   promoted somebody a second ago, so this is phrased as what this list shows
 *   rather than as a fact. It never hides a control, and anything it does *not*
 *   refuse is still submitted and the `409` handled — being wrong in the
 *   blocking direction, with a confident explanation, is the worse failure.
 *
 * Deliberately absent: any guard on deactivating a team lead. The server has
 * none, even if they are the only one, and inventing one here would refuse work
 * the food bank is allowed to do.
 */
export function refuseLockout({
  users,
  actorId,
  target,
  change,
}: {
  users: readonly User[];
  actorId: string;
  target: User;
  change: UserChange;
}): Refusal | null {
  const wasActiveAdmin = target.role === 'admin' && target.isActive;
  const nextRole = change.kind === 'role' ? change.role : target.role;
  const nextActive = change.kind === 'deactivate' ? false : target.isActive;

  if (!wasActiveAdmin || (nextRole === 'admin' && nextActive)) return null;

  if (target.id === actorId) {
    return {
      code: 'self',
      reason:
        'You cannot change your own role or deactivate your own account. Another administrator has to do it for you.',
    };
  }

  const othersWhoCouldAdminister = users.filter(
    (user) => user.id !== target.id && user.role === 'admin' && user.isActive,
  );

  if (othersWhoCouldAdminister.length > 0) return null;

  return {
    code: 'last-active-admin',
    reason: `As far as this list shows, ${target.displayName} is the only active administrator. Add or promote another one first, or nobody will be able to administer the food bank.`,
  };
}

/**
 * Finds an existing account for an address, matching the way the server does:
 * trimmed and lowercased, because that is what `create` stores.
 *
 * Safe to trust in a way a cached check normally is not — **there is no delete
 * and email is not amendable**, so a row that matches cannot have stopped
 * matching. A hit is therefore a guaranteed `409`, which is what makes it worth
 * saying before the form is submitted rather than after.
 */
export function findUserByEmail(users: readonly User[], email: string): User | undefined {
  const wanted = email.trim().toLowerCase();
  if (wanted === '') return undefined;

  return users.find((user) => user.email.trim().toLowerCase() === wanted);
}

export type LockoutConflict = RefusalCode | 'unclassified';

/**
 * Both lockout refusals arrive as `409 CONFLICT` and differ **only by their
 * message**, so this classifies on the smallest fragment of each that is likely
 * to survive an edit to the server's copy:
 *
 * - `You cannot demote or deactivate your own account`
 * - `The last active admin cannot be demoted or deactivated`
 *
 * It is fragile by construction, and the fragility is contained: the only thing
 * classification decides is whether to refetch the list. When it fails, the
 * caller shows the server's sentence verbatim and **adds nothing** — no
 * manufactured next step, because a wrong next step is worse than none. There is
 * a `details` discriminator on the server's wishlist for exactly this; see
 * KNOWN-GAPS.md.
 */
export function classifyLockoutConflict(message: string): LockoutConflict {
  const text = message.toLowerCase();

  if (text.includes('your own account')) return 'self';
  if (text.includes('last active admin')) return 'last-active-admin';

  return 'unclassified';
}
