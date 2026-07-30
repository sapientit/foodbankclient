import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

/**
 * jsdom implements no part of `<dialog>` — not `showModal`, not the top layer,
 * not native focus containment. So these tests exercise the fallback path, which
 * is also what a browser without `<dialog>` support gets. See KNOWN-GAPS.md.
 */
function Host({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Deactivate Ada Lead
      </button>
      {open && (
        <ConfirmDialog
          confirmLabel="Deactivate"
          onCancel={() => {
            setOpen(false);
          }}
          onConfirm={onConfirm}
          title="Deactivate Ada Lead?"
        >
          <p>Nothing is deleted.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

describe('ConfirmDialog', () => {
  it('opens with focus on Cancel rather than on the destructive answer', async () => {
    render(<Host />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Deactivate Ada Lead' }));

    expect(screen.getByRole('dialog', { name: 'Deactivate Ada Lead?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the control that opened it', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Deactivate Ada Lead' });
    await user.click(opener);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Deactivate Ada Lead' }));

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Deactivate' });

    await user.tab();
    expect(confirm).toHaveFocus();

    // The last control wraps to the first instead of stepping onto the page
    // behind, where every control is one the dialog is asking about.
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('reports the confirmed answer once', async () => {
    const onConfirm = vi.fn();
    render(<Host onConfirm={onConfirm} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Deactivate Ada Lead' }));

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
