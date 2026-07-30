import { createContext, use } from 'react';
import type { AuthUser } from '../api/token-store';

/**
 * A discriminated union, not a user plus an `isLoading` flag.
 *
 * `restoring` and `signed-out` render completely differently — a spinner and the
 * sign-in screen — and the version with optional fields is how the login screen
 * flashes on every reload before the refresh comes back. `unknown` is the state
 * before anything has been attempted at all, which matters because the boot is
 * triggered by the route guard rather than by the provider.
 */
export type AuthState =
  | { status: 'unknown' }
  | { status: 'restoring' }
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'signed-out' };

export interface AuthContextValue {
  readonly state: AuthState;
  /** Called by the route guard, not on mount. See `auth-provider.tsx`. */
  readonly restoreSession: () => void;
  readonly signIn: (email: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);

  if (value === null) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }

  return value;
}
