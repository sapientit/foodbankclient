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
      refereeAddress: '1 Example Street',
      refereePostcode: 'AB1 2CD',
      refereePhone: '01234 567890',
      answers: {
        'Pre-Payment': 'Yes',
        'Contact approved': 'No',
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
  it('shows a spreadsheet-ready row with both fuel answers prominent', async () => {
    renderApp('/fuel-help');

    const row = await screen.findByRole('row', { name: /Jamie Rowe/ });
    expect(row).toHaveTextContent('Tue, 4 Aug 2026');
    expect(row).toHaveTextContent('1 Example Street');
    expect(row).toHaveTextContent('AB1 2CD');
    expect(row).toHaveTextContent('01234 567890');
    expect(row).toHaveTextContent('Yes');
    expect(row).toHaveTextContent('No');
    expect(screen.getByRole('columnheader', { name: 'Permission to ring' })).toBeInTheDocument();
    expect(screen.queryByText(/Read permission to ring before calling/)).toBeNull();
  });

  it('never renders answers other than the two fuel questions', async () => {
    renderApp('/fuel-help');

    await screen.findByRole('row', { name: /Jamie Rowe/ });

    expect(screen.queryByText('Must not appear on this screen.')).toBeNull();
    expect(screen.queryByText(/Cause Details/)).toBeNull();
  });
});
