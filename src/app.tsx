import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { queryClient } from './api/query-client';
import { AuthProvider } from './auth/auth-provider';
import { router } from './routes';

/**
 * Composition root: providers and the router, and nothing else.
 *
 * It holds no screen of its own so that a later slice adds a route without
 * touching this file.
 *
 * `AuthProvider` wraps the router rather than sitting inside the authenticated
 * layout, because the sign-in screen needs it too — and it still costs an
 * unauthenticated visitor nothing, because restoring the session is the route
 * guard's job. See `auth-provider.tsx`.
 *
 * `main.tsx` mounts this in `StrictMode`, which double-invokes effects.
 * `ensureSession()` is already memoised against exactly that, so there is no
 * second guard here.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
