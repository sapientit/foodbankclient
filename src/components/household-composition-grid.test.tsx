import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HouseholdCompositionGrid } from './household-composition-grid';

/**
 * The grid is drawn entirely in icons, so what each symbol means has to be
 * available somewhere. A team lead gets it by hovering; a screen reader gets it
 * from the hidden text. The two must not be allowed to drift apart, and adding
 * the hover label must not have quietly become the cell's name instead.
 */
describe('the household composition grid', () => {
  it('names every icon on hover as well as to a screen reader', () => {
    render(<HouseholdCompositionGrid composition={{ '0-4': { male: 1 } }} />);

    for (const label of ['Female', 'Male', 'Non-Binary', 'Prefer not to say']) {
      expect(screen.getByRole('columnheader', { name: label })).toHaveAttribute('title', label);
    }
    for (const label of [
      '0–4',
      '5–11',
      '12–17',
      '18 to State Pension age',
      'State Pension age or over',
    ]) {
      expect(screen.getByRole('rowheader', { name: label })).toHaveAttribute('title', label);
    }
  });

  it('reads a cell as its age band, gender and count, and shows only the number', () => {
    render(<HouseholdCompositionGrid composition={{ '0-4': { male: 1 } }} />);

    expect(screen.getByText('0–4, Male: 1')).toBeInTheDocument();
    // Empty cells still read as zero rather than as nothing at all.
    expect(screen.getByText('0–4, Female: 0')).toBeInTheDocument();
  });
});
