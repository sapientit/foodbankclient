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

  /*
   * Red is claimed by name here rather than proved by colour, because jsdom
   * evaluates no stylesheet — `test/tooling/button-styles.test.ts` is what
   * holds the other end of it. The rule worth protecting is that a
   * confirmation is red only when the answer cannot be taken back: every
   * dialog in the application used to be, including the ones asking whether
   * somebody meant to save, and a warning that is always on is not a warning.
   */
  it('draws an answer that cannot be taken back in red, and an ordinary one as an ordinary action', () => {
    const cancelTheSession = render(
      <ConfirmDialog
        confirmLabel="Cancel the session"
        destructive
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="Cancel Thursday 5 June?"
      >
        <p>The households booked on it are told nothing by this.</p>
      </ConfirmDialog>,
    );

    expect(cancelTheSession.getByRole('button', { name: 'Cancel the session' })).toHaveClass(
      'button-danger',
    );

    cancelTheSession.unmount();
    render(
      <ConfirmDialog
        confirmLabel="Save changes"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="Save these changes?"
      >
        <p>You can amend them again afterwards.</p>
      </ConfirmDialog>,
    );

    expect(screen.getByRole('button', { name: 'Save changes' })).not.toHaveClass('button-danger');
  });
});
