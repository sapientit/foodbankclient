import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { AuthProvider } from '../src/auth/auth-provider';
import { routes } from '../src/routes';

/**
 * Renders the real route table at a path, with the real providers around it and
 * only the API mocked. A screen test then proves its own wiring — that the route
 * exists, that the guard lets a signed-in user through, that the shell is there.
 *
 * **Every test in one file shares one signed-in actor.** `ensureSession()` is
 * memoised per page load by design, and a test file is one module registry, so
 * the first `POST /auth/refresh` a file makes decides who is signed in for all of
 * its tests. A test needing a different role belongs in its own file — which is
 * also how the team-lead `403` case is written.
 *
 * The query client is per render, and never the app's singleton: one test's cache
 * must not answer the next one's query.
 */
export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      // A retried 4xx would only slow the failure down, and every assertion here
      // is about the first answer the server gives.
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const router = createMemoryRouter(routes, { initialEntries: [path] });

  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );

  return { router, queryClient };
}
