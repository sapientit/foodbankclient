import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Spinner } from './spinner';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Spinner', () => {
  it('draws nothing while the wait is too short to be worth admitting to', () => {
    render(<Spinner label="Loading sessions…" />);

    // A spinner that appears and vanishes inside a frame reads as a flicker, and
    // makes a fast response look like a fault.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('appears once the wait is long enough to notice', () => {
    render(<Spinner label="Loading sessions…" />);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Loading sessions…');
  });

  it('appears at once when the spinner is the whole page', () => {
    // The session restore blanks the screen until it resolves, so there is
    // nothing for the delay to protect and a blank page to avoid.
    render(<Spinner delayMs={0} label="Signing you in…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Signing you in…');
  });
});
