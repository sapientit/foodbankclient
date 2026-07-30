import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../test/msw/server';
import { publicApi } from './client';
import { unwrap, unwrapVoid } from './unwrap';
import { ApiError } from '../lib/errors';

describe('unwrapVoid', () => {
  it('treats a 204 as success rather than a missing body', async () => {
    // The trap this function exists for. `POST /auth/logout` answers 204, where
    // openapi-fetch reports `data: undefined` with `response.ok` true — so the
    // obvious unwrap throws on a request that worked perfectly, and sign-out
    // starts failing for no visible reason.
    server.use(http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })));

    await expect(unwrapVoid(publicApi.POST('/api/v1/auth/logout'))).resolves.toBeUndefined();
  });

  it('still throws when a 204-shaped endpoint fails', async () => {
    server.use(
      http.post('/api/v1/auth/logout', () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Sign in again.', requestId: 'r1' } },
          { status: 401 },
        ),
      ),
    );

    await expect(unwrapVoid(publicApi.POST('/api/v1/auth/logout'))).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe('unwrap', () => {
  it('returns the body on success and throws an ApiError on failure', async () => {
    server.use(
      http.post('/api/v1/auth/dev-login', async ({ request }) => {
        const body = await request.json();
        return body !== null && typeof body === 'object' && 'email' in body
          ? HttpResponse.json({
              accessToken: 'a',
              expiresAt: 1,
              user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete', role: 'admin' },
            })
          : HttpResponse.json(
              { error: { code: 'BAD_REQUEST', message: 'No.', requestId: 'r1' } },
              { status: 400 },
            );
      }),
    );

    const token = await unwrap(
      publicApi.POST('/api/v1/auth/dev-login', { body: { email: 'pete@x.com' } }),
    );

    expect(token.user.displayName).toBe('Pete');
  });
});
