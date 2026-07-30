import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiErrorCode } from '../lib/errors';
import { ErrorNotice } from './error-notice';

function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details: Record<string, unknown> | null = null,
): ApiError {
  return new ApiError({ status, code, message, requestId: 'req-9f2c', details });
}

describe('ErrorNotice', () => {
  it('shows the server’s message verbatim for a 409', () => {
    // A 409 is not a failure to retry. It means the session is full, and that
    // sentence is the only useful thing the person is going to be told.
    render(<ErrorNotice error={apiError(409, 'CONFLICT', 'That session is full')} />);

    expect(screen.getByRole('alert')).toHaveTextContent('That session is full');
  });

  it('shows the server’s message verbatim for a 422', () => {
    render(
      <ErrorNotice
        error={apiError(422, 'UNPROCESSABLE', 'That reason is no longer offered on the form')}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'That reason is no longer offered on the form',
    );
  });

  it('shows a copyable request id for a 500', async () => {
    render(<ErrorNotice error={apiError(500, 'INTERNAL_ERROR', 'Something went wrong')} />);

    // Selectable on screen whether or not the clipboard is available — the
    // button is the convenience, not the only route to the value.
    const reference = screen.getByText('req-9f2c');
    expect(reference.tagName).toBe('CODE');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy reference' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('still apologises for a 500 that carries no request id', () => {
    render(
      <ErrorNotice
        error={
          new ApiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            message: 'Something went wrong',
            requestId: null,
            details: null,
          })
        }
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Nothing you did caused this.');
    expect(screen.queryByRole('button', { name: 'Copy reference' })).toBeNull();
  });

  it('never shows a raw error code to the user', () => {
    const failures = [
      apiError(400, 'BAD_REQUEST', 'Validation failed'),
      apiError(403, 'FORBIDDEN', 'Admins only'),
      apiError(404, 'NOT_FOUND', 'No such session'),
      apiError(409, 'CONFLICT', 'That session is full'),
      apiError(422, 'UNPROCESSABLE', 'That list is confirmed'),
      apiError(429, 'BAD_REQUEST', 'Slow down'),
      apiError(500, 'INTERNAL_ERROR', 'Something went wrong'),
    ];

    for (const failure of failures) {
      const { unmount } = render(<ErrorNotice error={failure} />);

      // FORBIDDEN on a screen tells a volunteer nothing and reads as a crash.
      expect(screen.getByRole('alert').textContent).not.toContain(failure.code);

      unmount();
    }
  });

  it('tells a team lead they lack access rather than crashing', () => {
    // Roles pick menus and never gate routes, so a team lead who follows an
    // admin link really does make the request and really does get a 403. That
    // is our bug in the menu, and the screen should say so.
    render(<ErrorNotice error={apiError(403, 'FORBIDDEN', 'Admins only')} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('You do not have access to this');
    expect(alert).toHaveTextContent('mistake in our menu');
  });

  it('says a 404 no longer exists rather than reporting a failure', () => {
    render(<ErrorNotice error={apiError(404, 'NOT_FOUND', 'No such session')} />);

    expect(screen.getByRole('alert')).toHaveTextContent('That no longer exists');
  });

  it('lists the fields a 400 named', () => {
    render(
      <ErrorNotice
        error={apiError(400, 'BAD_REQUEST', 'Validation failed', {
          issues: [
            { path: 'adults', message: 'Must be at least 1' },
            { path: 'postcode', message: 'Enter a valid postcode' },
          ],
        })}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Must be at least 1');
    expect(alert).toHaveTextContent('Enter a valid postcode');
  });

  it('offers no retry on a 429, so nobody taps through the rate limit', () => {
    const onRetry = vi.fn();
    render(<ErrorNotice error={apiError(429, 'BAD_REQUEST', 'Slow down')} onRetry={onRetry} />);

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers a manual retry when the request never reached the server', async () => {
    const onRetry = vi.fn();
    render(<ErrorNotice error={new TypeError('Failed to fetch')} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Check your connection');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
