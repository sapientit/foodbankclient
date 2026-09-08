import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

/**
 * One shared MSW server. Per-test handlers go through `server.use(...)`, and
 * `test/setup.ts` resets them between tests.
 *
 * The two stock-configuration catalogues have an explicit empty default: they
 * are independent read-only context now loaded by several existing screens.
 * Tests which exercise crates or groupings override these with their own
 * fixture. Every other request remains deliberately unhandled.
 */
export const server = setupServer(
  http.get('/api/v1/stock/groupings', () => HttpResponse.json({ items: [] })),
  http.get('/api/v1/stock/crates', () => HttpResponse.json({ items: [] })),
  http.get('/api/v1/stock/validation', () => HttpResponse.json({ issues: [] })),
);
