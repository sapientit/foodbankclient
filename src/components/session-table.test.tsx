import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SessionTable, type TabulatedSession } from './session-table';

const session: TabulatedSession = {
  id: 'session-1',
  sessionDate: '2026-08-04',
  startTime: '10:00',
  durationMinutes: 90,
  deliveryCapacity: 8,
  deliveryBooked: 8,
  booked: 12,
  capacity: 25,
  status: 'planned',
};

function renderTable(action?: (row: TabulatedSession) => ReactNode, captionHidden?: boolean) {
  const actionProp = action === undefined ? {} : { action };

  return render(
    <MemoryRouter>
      <SessionTable
        caption="Sessions"
        hrefFor={(row) => `/sessions/${row.id}`}
        sessions={[session]}
        {...(captionHidden === true ? { captionHidden: true } : {})}
        {...actionProp}
      />
    </MemoryRouter>,
  );
}

describe('SessionTable', () => {
  it('shows delivery occupancy as a capacity meter and says when a delivery run is full', () => {
    renderTable();

    expect(screen.getByRole('columnheader', { name: 'Deliveries' })).toBeInTheDocument();
    expect(screen.getByText('8 of 8 deliveries (full)')).toBeInTheDocument();
    expect(screen.getByText('12 of 25 booked')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Action' })).toBeNull();
  });

  it('renders an action column only when given a row action', () => {
    renderTable((row) => <button type="button">{`Run ${row.id}`}</button>);

    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run session-1' })).toBeInTheDocument();
  });

  it('can keep its table name for assistive technology without repeating visible context', () => {
    renderTable(undefined, true);

    expect(screen.getByRole('table', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByText('Sessions').className).toMatch(/visuallyHidden/);
  });
});
