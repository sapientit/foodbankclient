import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Pagination } from './pagination';

function Pager() {
  const [page, setPage] = useState(1);
  return <Pagination onPageChange={setPage} page={page} pageCount={3} />;
}

describe('Pagination', () => {
  it('disables Previous on the first page and moves to the next page', async () => {
    const user = userEvent.setup();
    render(<Pager />);

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('keeps both controls keyboard reachable and disables Next on the last page', async () => {
    const user = userEvent.setup();
    render(<Pager />);

    // A disabled native button is correctly skipped by Tab. The available
    // Next control is still keyboard reachable from the first page.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();

    await user.keyboard('{Enter}{Enter}');
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  /*
   * Regression test: a native `disabled` element cannot hold focus, so a
   * keyboard user pressing Enter on "Next" and landing on the last page used
   * to have their focus silently dropped to `<body>` — losing their place on
   * the page with no way to tell where they ended up.
   */
  it('moves focus to the page indicator when a click disables the button that held it', async () => {
    const user = userEvent.setup();
    render(<Pager />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    await user.keyboard('{Enter}{Enter}');

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByText('Page 3 of 3')).toHaveFocus();
  });
});
