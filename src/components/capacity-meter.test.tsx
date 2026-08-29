import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CapacityMeter } from './capacity-meter';

describe('CapacityMeter', () => {
  it.each([
    [0, '0 of 8 booked', 'open'],
    [8, '8 of 8 booked (full)', 'full'],
    [9, '9 of 8 booked (over capacity)', 'over'],
  ])('states the written occupancy as well as its visual state', (value, label, state) => {
    render(<CapacityMeter capacity={8} noun="booked" value={value} />);

    expect(screen.getByText(label).parentElement).toHaveAttribute('data-state', state);
  });
});
