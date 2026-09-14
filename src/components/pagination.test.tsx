import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Pagination } from './pagination';

function Pager({ initialPage = 1, pageCount = 3 }: { initialPage?: number; pageCount?: number }) {
  const [page, setPage] = useState(initialPage);
  return <Pagination onPageChange={setPage} page={page} pageCount={pageCount} />;
}

describe('Pagination', () => {
  it('shows only the available Next page control on the first page', async () => {
    const user = userEvent.setup();
    render(<Pager />);

    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('does not render pagination controls for a single page', () => {
    render(<Pager pageCount={1} />);

    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    expect(screen.queryByRole('button', { name: /page$/ })).toBeNull();
    expect(screen.queryByText('Page 1 of 1')).toBeNull();
  });

  it('keeps the available control keyboard reachable and leaves only Previous page on the last page', async () => {
    const user = userEvent.setup();
    render(<Pager />);

    // The sole available Next-page control is still keyboard reachable from
    // the first page.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveFocus();

    await user.keyboard('{Enter}{Enter}');
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  /*
   * Regression test: removing the final Next-page button must not strand focus
   * on `<body>` when keyboard activation lands on the final page.
   */
  it('moves focus to the page indicator when the focused Next page control disappears', async () => {
    const user = userEvent.setup();
    render(<Pager />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveFocus();
    await user.keyboard('{Enter}{Enter}');

    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByText('Page 3 of 3')).toHaveFocus();
  });
});
