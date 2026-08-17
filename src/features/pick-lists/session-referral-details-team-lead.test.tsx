import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

const SESSION_ID = 'session-1';

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@example.org', displayName: 'Lead', role: 'team_lead' },
      }),
    ),
  );
});

describe('team-lead session referral details', () => {
  it('shows and prints only the server-provided contact details', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/referral-details', ({ params }) => {
        expect(params.sessionId).toBe(SESSION_ID);
        return HttpResponse.json({
          sessionId: SESSION_ID,
          sessionDate: '2026-08-15',
          startTime: '10:00',
          location: 'St Mary’s Hall',
          referrals: [
            {
              referralId: 'r1',
              refereeFirstName: 'Jamie',
              refereeSurname: 'Rowe',
              refereeAddress: '1 Elm Street',
              refereePostcode: 'GU23 4XX',
              refereePhone: '01483 123456',
              referrerName: 'Sam Referrer',
              referrerPhone: '01483 999999',
            },
          ],
        });
      }),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);
    expect(await screen.findByRole('row', { name: /Jamie Rowe/ })).toBeInTheDocument();
    expect(screen.getByText('Sam Referrer')).toBeInTheDocument();
    expect(screen.queryByText('Reason for referral')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Print referral details' }));
    expect(print).toHaveBeenCalledOnce();
  });

  /**
   * The one failure this screen has that nothing else would catch: a table left
   * to size itself widens to fit its longest address and carries the referrer's
   * phone number off the right-hand edge of the paper. Nobody finds out until
   * they are in a hall wanting to ring somebody.
   *
   * The widths themselves are CSS and cannot be computed here, so this asserts
   * the machinery that carries them: a `<colgroup>` with exactly one `<col>`
   * per column. A seventh column added without a seventh `<col>` silently loses
   * its width and fails here instead.
   */
  it('gives every column a fixed width so a long address cannot push one off the page', async () => {
    server.use(
      http.get('/api/v1/sessions/:sessionId/referral-details', () =>
        HttpResponse.json({
          sessionId: SESSION_ID,
          sessionDate: '2026-08-15',
          startTime: '10:00',
          location: 'St Mary’s Hall',
          referrals: [
            {
              referralId: 'r1',
              refereeFirstName: 'Bartholomew',
              refereeSurname: 'Featherstonehaugh-Cholmondeley',
              refereeAddress: 'Flat 12b, The Old Biscuit Factory, 447 Wandsworth Bridge Road',
              refereePostcode: 'GU23 4XX',
              refereePhone: '01483 123456',
              referrerName: 'Sam Referrer',
              referrerPhone: '01483 999999',
            },
          ],
        }),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);

    const table = await screen.findByRole('table', {
      name: 'Referral details for every household on this session',
    });
    const headings = screen.getAllByRole('columnheader');
    expect(headings).toHaveLength(6);
    expect(table.querySelectorAll('colgroup > col')).toHaveLength(headings.length);
    // The long values are on the page in full rather than truncated into it:
    // the columns wrap, they do not clip.
    expect(
      screen.getByText('Flat 12b, The Old Biscuit Factory, 447 Wandsworth Bridge Road'),
    ).toBeInTheDocument();
    expect(screen.getByText('01483 999999')).toBeInTheDocument();
  });
});
