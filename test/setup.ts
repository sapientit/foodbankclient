import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server';

/*
 * A browser resolves a relative request URL against the document. Node does not.
 *
 * jsdom ships no `fetch`, so Vitest leaves Node's `Request` in place, and Node's
 * throws "Failed to parse URL" on `/api/v1/…`. That is the environment being
 * unlike a browser, not the app being wrong: `src/api/client.ts` uses
 * `baseUrl: ''` precisely so that no absolute origin can drift into being
 * cross-site and kill the `SameSite=Strict` refresh cookie. Restoring the
 * browser's behaviour here is cheaper and safer than giving production code an
 * origin it does not need.
 */
const NodeRequest = globalThis.Request;

globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, location.href) : input, init);
  }
};

beforeAll(() => {
  /*
   * `onUnhandledRequest: 'error'` is the setting that makes MSW worth having.
   *
   * Left at the default, a request to a path no handler matches resolves to
   * nothing, the component sits in its loading state, and the test asserts
   * happily against a spinner. Failing loudly turns a typo'd path into a
   * one-line diagnosis.
   */
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => {
  server.close();
});
