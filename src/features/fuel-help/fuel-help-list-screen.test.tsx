import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { FuelHelpList } from './queries';

const REFRESH = '/api/v1/auth/refresh';
const FUEL_HELP_LIST = '/api/v1/fuel-help-list';

const LIST: FuelHelpList = {
  households: [
    {
      referralId: '5a77a337-0b77-4ff5-a895-32f384df1cb0',
      sessionDate: '2026-08-04',
      refereeFirstName: 'Jamie',
      refereeSurname: 'Rowe',
      refereeDateOfBirth: '1975-08-04',
      refereeAddress: '1 Example Street',
      refereePostcode: 'AB1 2CD',
      refereePhone: '01234 567890',
      needsFuelHelp: true,
      answers: {
        refereeEmail: 'jamie@example.org',
        FuelPension: 'Yes',
        'Electricity crisis': 'Example Energy',
        'Electricity Smart': 'Yes',
        'Gas crisis': 'Example Gas',
        'Gas Smart': 'Yes',
        'Electricity debt': 'Yes',
        'Gas debt': 'Yes',
        Permission: 'Yes',
        'Cause Details': 'Must not appear on this screen.',
      },
    },
  ],
};

beforeEach(() => {
  server.use(
    http.post(REFRESH, () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: {
          id: 'fuel-1',
          email: 'fuel@example.org',
          displayName: 'Fuel volunteer',
          role: 'fuel_admin',
        },
      }),
    ),
    http.get(FUEL_HELP_LIST, () => HttpResponse.json(LIST)),
  );
});

describe('fuel help list', () => {
  it('shows every referral-form column marked for the fuel team', async () => {
    renderApp('/fuel-help');

    const row = await screen.findByRole('row', { name: /Jamie Rowe/ });
    expect(row).toHaveTextContent('Tue, 4 Aug 2026');
    expect(row).toHaveTextContent('1 Example Street');
    expect(row).toHaveTextContent('AB1 2CD');
    expect(row).toHaveTextContent('01234 567890');
    expect(row).toHaveTextContent('jamie@example.org');
    expect(row).toHaveTextContent('Example Energy');
    expect(row).toHaveTextContent('Example Gas');
    // A date, not the stored string and not an age: the fuel team uses it to
    // tell two households of the same name apart.
    expect(row).toHaveTextContent('4 Aug 1975');
    expect(
      screen.getByRole('columnheader', { name: "Client's date of birth" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', {
        name: 'Do you give permission to share details with "Energy Manage" who work in partnership with the foodbank to support our clients?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fuel help list' })).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText(/Read permission to ring before calling/)).toBeNull();
  });

  it('has no column for a marked field the endpoint does not send', async () => {
    /*
     * `needsFuelHelp` carried the marker while the endpoint withheld it, and the
     * column read "Not provided" on every row. The charity has since settled
     * that the fuel team does not want it — every household on this list needs
     * fuel help by definition — so the marker is off and the column is gone.
     * Asserted here because an empty column is the kind of thing a green test
     * run says nothing about.
     */
    renderApp('/fuel-help');

    await screen.findByRole('row', { name: /Jamie Rowe/ });

    expect(
      screen.queryByRole('columnheader', { name: 'Does the client need help with Energy costs?' }),
    ).toBeNull();
    expect(screen.queryByText('Not provided')).toBeNull();
  });

  it('says so plainly where a household gave no answer', async () => {
    server.use(
      http.get(FUEL_HELP_LIST, () =>
        HttpResponse.json({
          households: [
            {
              ...LIST.households[0],
              referralId: '6b88b448-1c88-4aa6-b9a6-43a495ea2dc1',
              refereeDateOfBirth: null,
              refereePhone: null,
              answers: { Permission: '' },
            },
          ],
        }),
      ),
    );

    renderApp('/fuel-help');

    const row = await screen.findByRole('row', { name: /Jamie Rowe/ });
    // A missing fixed field and an unanswered question read differently on
    // purpose: one was never sent, the other was asked and left blank.
    expect(row).toHaveTextContent('Not provided');
    expect(row).toHaveTextContent('Not answered');
  });

  it('never renders an answer without the fuel-team marker', async () => {
    renderApp('/fuel-help');

    await screen.findByRole('row', { name: /Jamie Rowe/ });

    expect(screen.queryByText('Must not appear on this screen.')).toBeNull();
    expect(screen.queryByText(/Cause Details/)).toBeNull();
  });
});
