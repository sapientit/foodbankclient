import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

const { writeClaim } = vi.hoisted(() => ({
  writeClaim: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock('./google-auth', () => ({
  requestSheetsAccess: vi.fn(() => Promise.resolve('google-token')),
}));
vi.mock('./google-sheets', () => ({ writeClaim }));

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: {
          id: 'admin-1',
          email: 'admin@example.org',
          displayName: 'Ada Admin',
          role: 'admin',
        },
      }),
    ),
  );
});

describe('spreadsheet extract', () => {
  it('asks whether to continue before asking Google for permission', async () => {
    renderApp('/extracts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start extract' }));

    expect(screen.getByRole('dialog', { name: 'This might take some time' })).toHaveTextContent(
      'Do you want to continue?',
    );
    expect(screen.queryByText('Waiting for Google Sheets permission…')).toBeNull();
  });

  it('pauses after twenty completed sessions', async () => {
    let claims = 0;
    server.use(
      http.get('/api/v1/extracts/config', () =>
        HttpResponse.json({ configured: true, spreadsheetId: 'sheet', googleClientId: 'client' }),
      ),
      http.post('/api/v1/extracts/claims', () => {
        claims += 1;
        return HttpResponse.json({
          remaining: 21 - claims,
          extracted: claims - 1,
          claim: {
            claimId: `00000000-0000-4000-8000-${String(claims).padStart(12, '0')}`,
            expiresAt: '2026-08-07T12:00:00Z',
            sessionId: '00000000-0000-4000-8000-000000000099',
            sessionDate: '2026-08-07',
            sessionLocation: "St Mary's Hall",
            rows: [],
          },
        });
      }),
      http.post('/api/v1/extracts/claims/:claimId/complete', () =>
        HttpResponse.json({
          remaining: 0,
          extracted: 1,
          sessionId: '00000000-0000-4000-8000-000000000099',
          extractedAt: '2026-08-07T12:00:00Z',
          alreadyExtracted: false,
        }),
      ),
    );
    renderApp('/extracts');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start extract' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('dialog', { name: 'Continue extracting?' })).toHaveTextContent(
      'Twenty sessions have been extracted',
    );
    expect(claims).toBe(20);
  });

  it('retries only the server completion after the sheet write succeeded', async () => {
    let completions = 0;
    let claims = 0;
    server.use(
      http.get('/api/v1/extracts/config', () =>
        HttpResponse.json({ configured: true, spreadsheetId: 'sheet', googleClientId: 'client' }),
      ),
      http.post('/api/v1/extracts/claims', () => {
        claims += 1;
        return HttpResponse.json(
          claims === 1
            ? {
                remaining: 1,
                extracted: 0,
                claim: {
                  claimId: '00000000-0000-4000-8000-000000000001',
                  expiresAt: '2026-08-07T12:00:00Z',
                  sessionId: '00000000-0000-4000-8000-000000000099',
                  sessionDate: '2026-08-07',
                  sessionLocation: "St Mary's Hall",
                  rows: [],
                },
              }
            : { remaining: 0, extracted: 1, claim: null },
        );
      }),
      http.post('/api/v1/extracts/claims/:claimId/complete', () => {
        completions += 1;
        return completions === 1
          ? HttpResponse.json(
              {
                error: {
                  code: 'INTERNAL_ERROR',
                  message: 'Try the completion again.',
                  requestId: 'r1',
                },
              },
              { status: 500 },
            )
          : HttpResponse.json({
              remaining: 0,
              extracted: 1,
              sessionId: '00000000-0000-4000-8000-000000000099',
              extractedAt: '2026-08-07T12:00:00Z',
              alreadyExtracted: false,
            });
      }),
    );
    writeClaim.mockClear();
    renderApp('/extracts');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start extract' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'Try marking this session extracted again' });
    expect(writeClaim).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole('button', { name: 'Try marking this session extracted again' }),
    );
    expect(writeClaim).toHaveBeenCalledTimes(1);
    expect(completions).toBe(2);
  });
});
