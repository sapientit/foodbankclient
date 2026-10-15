import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { SessionReferralDetails } from './queries';

const SESSION_ID = 'session-1';

const household = (
  referralId: string,
  firstName: string,
  surname: string,
  pickNumber: number | null,
  extra: Partial<SessionReferralDetails['referrals'][number]> = {},
): SessionReferralDetails['referrals'][number] => ({
  referralId,
  refereeFirstName: firstName,
  refereeSurname: surname,
  refereeAddress: '1 Elm Street',
  refereePostcode: 'GU23 4XX',
  refereePhone: '01483 123456',
  referrerName: 'Sam Referrer',
  referrerOrganisation: 'Citizens Advice',
  referrerPhone: '01483 999999',
  pickNumber,
  picklistAdmin: null,
  isDelivery: false,
  firstTimeMarker: null,
  voucherInstruction: null,
  ...extra,
});

function serveRunSheet(referrals: SessionReferralDetails['referrals']): void {
  server.use(
    http.get('/api/v1/sessions/:sessionId/referral-details', () =>
      HttpResponse.json({
        sessionId: SESSION_ID,
        sessionDate: '2026-08-15',
        startTime: '10:00',
        location: 'St Mary’s Hall',
        referrals,
      } satisfies SessionReferralDetails),
    ),
  );
}

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@example.org', displayName: 'Lead', role: 'team_lead' },
      }),
    ),
    // `RunSessionLayout` now wraps every route under `/run-sessions/:sessionId/*`
    // and fetches the session itself, for the shared date/time line and the tab
    // strip — so every test under this route needs this handler too.
    http.get('/api/v1/sessions/:sessionId', () =>
      HttpResponse.json({
        id: SESSION_ID,
        sessionDate: '2026-08-15',
        startTime: '10:00',
        startsAtUtc: '2026-08-15T09:00:00.000Z',
        durationMinutes: 90,
        location: 'St Mary’s Hall',
        deliveryWindowStart: null,
        deliveryWindowEnd: null,
        deliveryCapacity: 0,
        deliveryBooked: 0,
        capacity: 25,
        booked: 1,
        status: 'planned',
        cancelledReason: null,
        isCustomised: false,
        recurringSessionId: null,
        occurrenceDate: null,
      }),
    ),
    // The tab strip reads the pick list; the Run sheet itself does not need one.
    http.get('/api/v1/sessions/:sessionId/pick-list', () =>
      HttpResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'No pick list for this session.',
            details: null,
            requestId: 'req-1',
          },
        },
        { status: 404 },
      ),
    ),
    http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
      HttpResponse.json({ sessionId: SESSION_ID, unreadTotal: 0, households: [] }),
    ),
  );
});

describe('team-lead run sheet', () => {
  it('shows and prints the server-provided contact details with their pick number', async () => {
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
              pickNumber: 1,
              picklistAdmin: null,
              isDelivery: false,
              firstTimeMarker: null,
              voucherInstruction: null,
            },
          ],
        });
      }),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);
    expect(await screen.findByRole('row', { name: /Jamie Rowe/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Run sheet' })).toBeInTheDocument();
    const details = screen.getByRole('region', { name: 'Run sheet' });
    expect(within(details).getByRole('button', { name: 'Print run sheet' })).toBeInTheDocument();
    expect(screen.queryByText('St Mary’s Hall')).toBeNull();
    expect(screen.getByRole('row', { name: /Jamie Rowe/ })).toHaveTextContent('#1');
    expect(screen.getByText('Sam Referrer')).toBeInTheDocument();
    expect(screen.queryByText('Reason for referral')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Print run sheet' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('lists households in pick-number order, with any not yet picked after them', async () => {
    const household = (referralId: string, surname: string, pickNumber: number | null) => ({
      referralId,
      refereeFirstName: 'Pat',
      refereeSurname: surname,
      refereeAddress: '1 Elm Street',
      refereePostcode: 'GU23 4XX',
      refereePhone: '01483 123456',
      referrerName: 'Sam Referrer',
      referrerPhone: '01483 999999',
      pickNumber,
      picklistAdmin: null,
      isDelivery: false,
      firstTimeMarker: null,
      voucherInstruction: null,
    });
    server.use(
      http.get('/api/v1/sessions/:sessionId/referral-details', () =>
        HttpResponse.json({
          sessionId: SESSION_ID,
          sessionDate: '2026-08-15',
          startTime: '10:00',
          location: 'St Mary’s Hall',
          // In name order, as the server sends them.
          referrals: [
            household('r1', 'Adams', 3),
            household('r2', 'Baker', null),
            household('r3', 'Clark', 1),
            household('r4', 'Davies', 2),
          ],
        }),
      ),
    );
    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);
    await screen.findByRole('row', { name: /Pat Adams/ });
    const body = screen.getAllByRole('rowgroup')[1];
    if (body === undefined) throw new Error('The table has no body');
    expect(
      within(body)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Pat Clark', 'Pat Davies', 'Pat Adams', 'Pat Baker']);
  });

  /**
   * The one failure this screen has that nothing else would catch: a table left
   * to size itself widens to fit its longest address and carries the referrer's
   * phone number off the right-hand edge of the paper. Nobody finds out until
   * they are in a hall wanting to ring somebody.
   *
   * The widths themselves are CSS and cannot be computed here, so this asserts
   * the machinery that carries them: a `<colgroup>` with exactly one `<col>`
   * per column. A column added without its `<col>` silently loses its width and
   * fails here instead — with and without the Voucher column, which comes and
   * goes with the voucher scheme.
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
              pickNumber: null,
              answers: {},
              formId: 'form-1',
              firstTimeMarker: null,
              voucherInstruction: null,
            },
          ],
        }),
      ),
    );

    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);

    const table = await screen.findByRole('table', {
      name: 'Run sheet for every household on this session',
    });
    const headings = screen.getAllByRole('columnheader');
    expect(headings).toHaveLength(10);
    expect(table.querySelectorAll('colgroup > col')).toHaveLength(headings.length);
    // The long values are on the page in full rather than truncated into it:
    // the columns wrap, they do not clip.
    expect(
      screen.getByText('Flat 12b, The Old Biscuit Factory, 447 Wandsworth Bridge Road'),
    ).toBeInTheDocument();
    expect(screen.getByText('01483 999999')).toBeInTheDocument();
    expect(screen.getByLabelText('No pick number assigned')).toBeInTheDocument();
  });

  it('keeps a width for every column while the Voucher column is drawn', async () => {
    serveRunSheet([household('r1', 'Jamie', 'Rowe', 1, { voucherInstruction: 'provide_voucher' })]);

    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);

    const table = await screen.findByRole('table', {
      name: 'Run sheet for every household on this session',
    });
    const headings = within(table).getAllByRole('columnheader');
    expect(headings).toHaveLength(11);
    expect(table.querySelectorAll('colgroup > col')).toHaveLength(headings.length);
  });

  /**
   * `screenDetails.md`, "#Session processing": the Run sheet carries the same
   * first-time marker, voucher instruction and referrer comments as the Client
   * List — from the referral, so a household with no pick number yet has them
   * too.
   */
  it("shows each household's first-time marker, voucher instruction and referrer comments", async () => {
    serveRunSheet([
      household('r1', 'Jamie', 'Rowe', 1, {
        firstTimeMarker: 'first_time',
        voucherInstruction: 'provide_voucher',
        picklistAdmin: 'Ring the bell twice',
      }),
      household('r2', 'Alex', 'Shaw', null, {
        voucherInstruction: 'already_received',
        picklistAdmin: 'No tins',
      }),
    ]);

    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);

    const table = await screen.findByRole('table', {
      name: 'Run sheet for every household on this session',
    });
    const headings = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headings.slice(-4)).toEqual(['Del?', 'First?', 'Voucher', 'Pick list notes']);

    const cellsOf = (name: RegExp) =>
      within(screen.getByRole('row', { name }))
        .getAllByRole('cell')
        .slice(-4)
        .map((cell) => cell.textContent);
    expect(cellsOf(/Jamie Rowe/)).toEqual([
      '',
      'First time',
      'Provide voucher for this client',
      'Ring the bell twice',
    ]);
    // Not yet picked for, and still shown. A recorded previous session leaves
    // First? blank, as on the Client List.
    expect(cellsOf(/Alex Shaw/)).toEqual([
      '',
      '',
      'Client has already received voucher',
      'No tins',
    ]);
  });

  it('leaves out the Voucher column when the voucher scheme does not apply', async () => {
    serveRunSheet([household('r1', 'Jamie', 'Rowe', 1, { firstTimeMarker: 'admin' })]);

    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);

    const row = await screen.findByRole('row', { name: /Jamie Rowe/ });
    expect(screen.queryByRole('columnheader', { name: 'Voucher' })).toBeNull();
    expect(within(row).getByRole('cell', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows the pick-list note and no arbitrary referral answer', async () => {
    serveRunSheet([
      household('r1', 'Jamie', 'Rowe', 1, {
        picklistAdmin: 'Ring the bell twice',
      }),
    ]);

    renderApp(`/run-sessions/${SESSION_ID}/referral-details`);

    await screen.findByRole('row', { name: /Jamie Rowe/ });
    expect(screen.getByText('Ring the bell twice')).toBeInTheDocument();
    expect(screen.queryByText('Peanuts')).toBeNull();
    expect(screen.queryByText('Dog')).toBeNull();
  });
});
