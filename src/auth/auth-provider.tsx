import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { subscribeToAuthEvents } from '../api/token-store';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';
import { ensureSession, signIn as startSession, signOut as endSession } from './session';

/**
 * Holds the current user and nothing else. Server state belongs to TanStack
 * Query; this is the one piece of genuinely global app state there is.
 *
 * **It does not restore the session on mount.** The provider has to wrap the
 * whole router so the sign-in screen can use it, but refreshing on mount would
 * fire a `POST /auth/refresh` for every visitor to the public referral form —
 * people who have never signed in and never will. The route guard triggers the
 * boot instead, which is what keeps the referral flow unblocked by an auth round
 * trip it does not need. That is a structural choice, not an optimisation:
 * moving the call into an effect here quietly couples the public flow to auth.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'unknown' });

  useEffect(
    () =>
      // `auth-fetch` refreshes and signs out on its own, off the back of some
      // other request's 401. This is how that reaches the screen.
      subscribeToAuthEvents((event) => {
        setState(
          event.type === 'refreshed'
            ? { status: 'signed-in', user: event.user }
            : { status: 'signed-out' },
        );
      }),
    [],
  );

  const restoreSession = useCallback(() => {
    setState((current) => (current.status === 'unknown' ? { status: 'restoring' } : current));

    void ensureSession().then((user) => {
      // Only ever resolves the restore. A guard that mounts later — after a
      // sign-out, say — must not be able to reinstate the memoised boot result.
      setState((current) =>
        current.status === 'restoring'
          ? user === null
            ? { status: 'signed-out' }
            : { status: 'signed-in', user }
          : current,
      );
    });
  }, []);

  const signIn = useCallback(async (email: string) => {
    const user = await startSession(email);
    setState({ status: 'signed-in', user });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    await endSession();
    setState({ status: 'signed-out' });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, restoreSession, signIn, signOut }),
    [state, restoreSession, signIn, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
