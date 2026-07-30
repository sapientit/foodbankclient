import { setupServer } from 'msw/node';

/**
 * One shared MSW server. Per-test handlers go through `server.use(...)`, and
 * `test/setup.ts` resets them between tests.
 *
 * Deliberately starts with no handlers: `onUnhandledRequest: 'error'` in the
 * setup file means every request a test makes has to be declared by that test,
 * which is what stops a screen quietly asserting against a shape nobody checked.
 */
export const server = setupServer();
