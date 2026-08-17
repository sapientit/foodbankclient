import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import { ShowableError } from '../../lib/errors';

const { writeClaim } = vi.hoisted(() => ({
  writeClaim: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock('./google-auth', () => ({
  requestSheetsAccess: vi.fn(() => Promise.resolve('google-token')),
}));
vi.mock('./google-sheets', () => ({ writeClaim }));

/*
 * The reason lookup this screen resolves answers through — the admin one, which
 * names retired reasons, because an archive of past referrals is full of them.
 * An answer chosen from the list is stored as an id, and an id in a spreadsheet
 * helps nobody who has to read one.
 */
const REASONS = [
  { id: 'reason-debt', code: 'debt', label: 'Debt', displayOrder: 1, isActive: false },
];

beforeEach(() => {
  server.use(
    http.get('/api/v1/referral-reasons', () => HttpResponse.json({ referralReasons: REASONS })),
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

  it('gives the sheet writer the reason lookup, so an answer is archived as words and not an id', async () => {
    let claims = 0;
    server.use(
      http.get('/api/v1/extracts/config', () =>
        HttpResponse.json({ configured: true, spreadsheetId: 'sheet', googleClientId: 'client' }),
      ),
      http.post('/api/v1/extracts/claims', () => {
        claims += 1;
        return HttpResponse.json(
          claims > 1
            ? { remaining: 0, extracted: 1, claim: null }
            : {
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
              },
        );
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
    writeClaim.mockClear();
    renderApp('/extracts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start extract' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await vi.waitFor(() => {
      expect(writeClaim).toHaveBeenCalled();
    });

    // Without this fourth argument every reason-backed answer reaches the
    // charity's archive as a UUID, permanently. A retired reason is in the list
    // because the archive is full of them.
    expect(writeClaim.mock.calls[0]?.[3]).toEqual({
      referralReasons: [{ value: 'reason-debt', label: 'Debt' }],
    });
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

  /**
   * Pressing the button on the error screen was suspected of being what marked
   * sessions extracted. It is not — it clears two refs and puts the screen back
   * to idle, and this test is the evidence rather than an assurance.
   *
   * The suspicion was reasonable and the label earned it: "Finish" reads as
   * finishing the job on a screen that has just failed to do it.
   */
  it('makes no request at all when the run is abandoned after an error', async () => {
    let claims = 0;
    let completions = 0;
    server.use(
      http.get('/api/v1/extracts/config', () =>
        HttpResponse.json({ configured: true, spreadsheetId: 'sheet', googleClientId: 'client' }),
      ),
      http.post('/api/v1/extracts/claims', () => {
        claims += 1;
        return HttpResponse.json({
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
        });
      }),
      http.post('/api/v1/extracts/claims/:claimId/complete', () => {
        completions += 1;
        return HttpResponse.json({
          remaining: 0,
          extracted: 1,
          sessionId: '00000000-0000-4000-8000-000000000099',
          extractedAt: '2026-08-07T12:00:00Z',
          alreadyExtracted: false,
        });
      }),
    );
    writeClaim.mockClear();
    // A `ShowableError`, which is what `GoogleSheetsError` is — the real module
    // is mocked out here, and what matters is that the sentence reaches the
    // screen rather than which subclass carried it.
    writeClaim.mockRejectedValueOnce(
      new ShowableError('The archive’s hidden key row does not match the extract format.'),
    );

    renderApp('/extracts');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start extract' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // The spreadsheet's own sentence, not a story about the connection.
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match the extract format');
    expect(completions).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Stop extracting' }));

    // Leaving the failed run marks nothing and claims nothing more. The session
    // stays unextracted and returns to the queue when its claim lapses.
    expect(completions).toBe(0);
    expect(claims).toBe(1);
  });

  /**
   * Sessions are what the loop works through; rows are what land in the
   * spreadsheet. A session with four referrals on it adds four rows, and it is
   * rows an administrator counts when they go and look at the sheet.
   */
  it('counts the rows it has added to Sheets, not just the sessions', async () => {
    let claims = 0;
    const row = {
      referralId: '00000000-0000-4000-8000-00000000000a',
      status: 'active',
      referredAt: '2026-08-01T09:00:00Z',
      referrerOrganisation: 'A Charity',
      refereeDateOfBirth: null,
      refereePostcode: 'AB1 2CD',
      adults: 1,
      children: 0,
      isDelivery: false,
      needsFuelHelp: false,
      reason: null,
      reviewComment: null,
      answers: {},
    };
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
                  // Three referrals on one session — three rows from one
                  // completed session, which is the distinction being tested.
                  rows: [row, row, row],
                },
              }
            : { remaining: 0, extracted: 1, claim: null },
        );
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
    writeClaim.mockClear();
    renderApp('/extracts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start extract' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText(/1 extracted in this run, 3 rows added to Sheets/),
    ).toBeInTheDocument();
  });

  it('counts rows written even when marking the session extracted then fails', async () => {
    // The rows are in the spreadsheet at that point and the session is not
    // marked, so the count is what somebody checks the sheet against.
    let claims = 0;
    const row = {
      referralId: '00000000-0000-4000-8000-00000000000a',
      status: 'active',
      referredAt: '2026-08-01T09:00:00Z',
      referrerOrganisation: 'A Charity',
      refereeDateOfBirth: null,
      refereePostcode: 'AB1 2CD',
      adults: 1,
      children: 0,
      isDelivery: false,
      needsFuelHelp: false,
      reason: null,
      reviewComment: null,
      answers: {},
    };
    server.use(
      http.get('/api/v1/extracts/config', () =>
        HttpResponse.json({ configured: true, spreadsheetId: 'sheet', googleClientId: 'client' }),
      ),
      http.post('/api/v1/extracts/claims', () => {
        claims += 1;
        return HttpResponse.json({
          remaining: 1,
          extracted: 0,
          claim: {
            claimId: '00000000-0000-4000-8000-000000000001',
            expiresAt: '2026-08-07T12:00:00Z',
            sessionId: '00000000-0000-4000-8000-000000000099',
            sessionDate: '2026-08-07',
            sessionLocation: "St Mary's Hall",
            rows: [row, row],
          },
        });
      }),
      http.post('/api/v1/extracts/claims/:claimId/complete', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Try again.', requestId: 'r1' } },
          { status: 500 },
        ),
      ),
    );
    writeClaim.mockClear();
    renderApp('/extracts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start extract' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('button', { name: 'Try marking this session extracted again' });
    expect(screen.getByText(/2 rows added to Sheets in this run/)).toBeInTheDocument();
    expect(claims).toBe(1);
  });

  /**
   * `screenDetails.md`: a failed run never offers to finish. "Finish" on a
   * screen that has just failed reads as finishing the job, which is exactly
   * how it came to be blamed for marking sessions extracted.
   */
  it('offers to carry on or to stop after a failure, and never to finish', async () => {
    server.use(http.get('/api/v1/extracts/config', () => HttpResponse.json({ configured: false })));
    renderApp('/extracts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start extract' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Spreadsheet extraction is not configured for this deployment.',
    );
    expect(screen.getByText(/No session was marked extracted by this failure/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop extracting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
  });
});
