import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/msw/server';
import { App } from './app';

/**
 * The composition root end to end, with nothing mocked out but the API: the
 * query client, the auth provider and the real browser router, booting the way a
 * browser boots them. When this fails the problem is the wiring, not a screen.
 */
describe('App', () => {
  it('boots and lands a visitor with no session on the sign-in screen', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Sign in again.', requestId: 'r1' } },
          { status: 401 },
        ),
      ),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
